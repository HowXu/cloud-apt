import type { Bindings } from './env';
import { checkAuth } from './shared/auth';
import { validateSuite, validateUploadPath } from './shared/path';

function safeRelative(name: string): boolean {
    if (!name) return false;
    if (name.startsWith('/')) return false;
    const parts = name.split('/');
    for (const part of parts) if (part === '' || part === '.' || part === '..') return false;
    for (const ch of name) if (ch === '\\' || ch === '\0' || ch === '\r' || ch === '\n') return false;
    return true;
}

export const releaseKey = (suite: string) => `releases/${suite}.json`;
const RELEASE_ID = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ARCH = /^[a-z0-9][a-z0-9.+-]{0,31}$/;
type FileRecord = { key: string; sha256: string; size: number };
export type PackageRecord = {
    package: string;
    version: string;
    architecture: string;
    filename: string;
    sha256: string;
    size: number;
};

function validatePackage(record: unknown): record is PackageRecord {
    if (!record || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    if (typeof r.package !== 'string' || !/^[a-z0-9][a-z0-9.+-]{1,62}$/.test(r.package)) return false;
    if (typeof r.version !== 'string' || r.version.length === 0 || r.version.length > 128) return false;
    if (typeof r.architecture !== 'string' || !ARCH.test(r.architecture)) return false;
    if (typeof r.filename !== 'string' || !safeRelative(r.filename) || !r.filename.startsWith('pool/')) return false;
    if (typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) return false;
    if (!Number.isSafeInteger(r.size) || (r.size as number) <= 0) return false;
    return true;
}

export function isImmutable(key: string): boolean {
    return key.startsWith('pool/') || key.includes('/by-hash/') || key.includes('/.snapshots/');
}

export async function resolveIndexKey(bucket: R2Bucket, key: string): Promise<string> {
    const match = /^dists\/([^/]+)\/(.+)$/.exec(key);
    if (!match || key.includes('/by-hash/') || key.includes('/.snapshots/')) return key;
    const current = await bucket.get(releaseKey(match[1]));
    if (!current) return key; // Existing repositories continue to work until first publish.
    const { release } = await current.json<{ release: string }>();
    if (!RELEASE_ID.test(release)) throw new Error('Invalid current release');
    return `dists/${match[1]}/.snapshots/${release}/${match[2]}`;
}

export async function handlePublish(req: Request, suite: string, env: Bindings): Promise<Response> {
    if (!checkAuth(req, env)) return new Response('Unauthorized', { status: 401 });
    if (!validateSuite(suite)) return new Response('Invalid suite', { status: 400 });
    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });
    if (req.method === 'GET') {
        const current = await bucket.get(releaseKey(suite));
        if (!current) {
            return Response.json({ release: null, etag: null, packages: [] },
                { headers: { 'Cache-Control': 'no-store' } });
        }
        const data = await current.json<{ release: string; packages?: PackageRecord[] }>();
        return Response.json({
            release: data.release, etag: current.etag, packages: data.packages ?? [],
        }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    let data: { release: string; previous: string | null; files: FileRecord[]; packages?: PackageRecord[] };
    try {
        const body = await req.text();
        if (body.length > 1024 * 1024) return new Response('Manifest too large', { status: 413 });
        const parsed = JSON.parse(body);
        if (!parsed || !RELEASE_ID.test(parsed.release) ||
            !(parsed.previous === null || typeof parsed.previous === 'string') ||
            !Array.isArray(parsed.files) || !parsed.files.length) throw new Error();
        data = parsed;
        const prefix = `dists/${suite}/.snapshots/${data.release}/`;
        const seen = new Set<string>();
        for (const f of data.files) {
            if (!f || typeof f.key !== 'string' || !validateUploadPath(f.key).ok ||
                !SHA256.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || seen.has(f.key) ||
                !(f.key.startsWith(prefix) || f.key.startsWith('pool/') ||
                    (f.key.startsWith(`dists/${suite}/`) && /\/by-hash\/SHA256\/[a-f0-9]{64}$/.test(f.key)))) throw new Error();
            if (f.key.includes('/by-hash/') && !f.key.endsWith(`/${f.sha256}`)) throw new Error();
            seen.add(f.key);
        }
        for (const name of ['InRelease', 'Release', 'Release.gpg']) {
            if (!seen.has(prefix + name)) throw new Error();
        }
        // `packages` is optional for backward compatibility with older publishers
        // that pre-date the catalog API; missing/empty means the catalog will
        // appear empty on subsequent GETs until the next commit supplies it.
        const packages = Array.isArray(data.packages) ? data.packages : [];
        const packageFilenames = new Set<string>();
        for (const p of packages) {
            if (!validatePackage(p)) throw new Error();
            if (packageFilenames.has(p.filename)) throw new Error();
            packageFilenames.add(p.filename);
        }
        data.packages = packages;
    } catch {
        return new Response('Invalid publication manifest', { status: 400 });
    }
    const current = await bucket.get(releaseKey(suite));
    const active = current ? await current.json<{ release: string; manifest: string }>() : null;
    // Hash the manifest too: a reused id may only retry exactly the same publication.
    const canonical = JSON.stringify([...data.files].sort((a, b) => a.key.localeCompare(b.key)));
    const manifest = await digest(new TextEncoder().encode(canonical));
    if (active) {
        if (active.release === data.release) {
            return active.manifest === manifest ? new Response('OK') : new Response('Release id reused', { status: 409 });
        }
    }
    if ((current?.etag ?? null) !== data.previous) return new Response('Another publication won; sync again', { status: 409 });

    // List metadata in groups instead of a HEAD per file (Workers subrequest limits).
    // Every listed object is immutable, so validation remains true until the commit.
    const groups = new Map<string, Map<string, FileRecord>>();
    for (const f of data.files) {
        const prefix = f.key.startsWith('pool/') ? 'pool/' : f.key.slice(0, f.key.lastIndexOf('/') + 1);
        if (!groups.has(prefix)) groups.set(prefix, new Map());
        groups.get(prefix)!.set(f.key, f);
    }
    for (const [prefix, pending] of groups) {
        let cursor: string | undefined;
        do {
            // R2 supports include, but the default workers-types entrypoint omits it.
            const options: R2ListOptions & { include: string[] } = { prefix, cursor, include: ['customMetadata'] };
            const result = await bucket.list(options);
            for (const obj of result.objects) {
                const expected = pending.get(obj.key);
                if (!expected) continue;
                if (obj.size !== expected.size || obj.customMetadata?.sha256 !== expected.sha256) {
                    return new Response(`Unverified file: ${obj.key}`, { status: 409 });
                }
                pending.delete(obj.key);
            }
            cursor = result.truncated ? result.cursor : undefined;
        } while (cursor && pending.size);
        if (pending.size) return new Response(`Missing file: ${pending.keys().next().value}`, { status: 409 });
    }
    const committed = await bucket.put(releaseKey(suite),
        JSON.stringify({ release: data.release, manifest, packages: data.packages ?? [] }), {
            onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
        });
    return committed ? new Response('OK') : new Response('Concurrent publication; sync again', { status: 409 });
}

export async function digest(body: BufferSource): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', body);
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
