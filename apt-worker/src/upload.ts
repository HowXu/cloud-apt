import type { Bindings } from './env';
import { checkAuth } from './shared/auth';
import { validateUploadPath, ALLOWED_EXACT } from './shared/path';
import { digest, isImmutable } from './releases';

export async function handleUpload(req: Request, env: Bindings): Promise<Response> {
    if (req.method !== 'PUT' && req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!checkAuth(req, env)) {
        return new Response('unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    let rawPath: string;
    try {
        rawPath = decodeURIComponent(url.pathname.replace(/^\/api\/upload\//, ''));
    } catch {
        return new Response('Invalid path encoding', { status: 400 });
    }

    const validated = validateUploadPath(rawPath);
    if (!validated.ok) {
        return new Response(`Bad Request: ${validated.error}`, { status: 400 });
    }

    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });

    if (req.method === 'PUT') {
        const contentType = req.headers.get('Content-Type') || 'application/octet-stream';
        let allowed: string[];
        if (validated.key.startsWith('pool/')) {
            allowed = ['application/octet-stream', 'application/vnd.debian.binary-package'];
        } else if (validated.key.startsWith('dists/')) {
            allowed = ['text/plain', 'application/x-gzip', 'application/gzip', 'application/x-xz', 'application/octet-stream'];
        } else if (ALLOWED_EXACT.includes(validated.key)) {
            // scripts/install.sh / pubkey.asc — proxy 在 GET 端已 pin Content-Type,
            // 这里只允许 text/plain 系 + binary 供某些自动化工具用 octet-stream 上传
            allowed = ['text/plain', 'text/plain; charset=utf-8', 'application/octet-stream'];
        } else {
            return new Response('Invalid upload path', { status: 400 });
        }
        if (!allowed.some(p => contentType.toLowerCase().startsWith(p))) {
            return new Response(`Invalid Content-Type for ${validated.key}`, { status: 400 });
        }
        const body = await req.arrayBuffer();
        const sha256 = await digest(body);
        if (req.headers.has('X-Content-SHA256') && req.headers.get('X-Content-SHA256') !== sha256) {
            return new Response('Checksum mismatch', { status: 400 });
        }
        if (isImmutable(validated.key)) {
            let saved = await bucket.put(validated.key, body, {
                onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType }, customMetadata: { sha256 },
            });
            if (!saved) {
                const existing = await bucket.head(validated.key);
                let existingHash = existing?.customMetadata?.sha256;
                if (existing && !existingHash) {
                    const legacy = await bucket.get(validated.key);
                    if (legacy) existingHash = await digest(await legacy.arrayBuffer());
                }
                if (!existing || existingHash !== sha256) {
                    return new Response('Immutable file differs; use a new package version', { status: 409 });
                }
                // Adopt identical legacy objects without changing their content.
                if (!existing.customMetadata?.sha256) {
                    saved = await bucket.put(validated.key, body, { onlyIf: { etagMatches: existing.etag },
                        httpMetadata: { contentType }, customMetadata: { sha256 } });
                    if (!saved) return new Response('Concurrent upload; retry', { status: 409 });
                }
            }
        } else {
            await bucket.put(validated.key, body, { httpMetadata: { contentType }, customMetadata: { sha256 } });
        }
        return new Response('OK', { headers: { 'X-Content-SHA256': sha256 } });
    } else {
        if (isImmutable(validated.key)) return new Response('Retained publication file cannot be deleted', { status: 409 });
        await bucket.delete(validated.key);
    }

    return new Response('OK', { status: 200 });
}
