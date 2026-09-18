import type { Bindings } from './env';
import { checkAuth } from './shared/auth';
import { validateUploadPath, ALLOWED_EXACT } from './shared/path';
import { digest, isImmutable } from './releases';
import { signR2PutUrl } from './shared/s3-signer';

const SHA256_RE = /^[a-fA-F0-9]{64}$/;
const R2_MAX_PUT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

interface PresignBody {
    size: number;
    sha256: string;
    content_type?: string;
}

function allowedContentType(key: string, ct: string): boolean {
    const lc = ct.toLowerCase();
    if (key.startsWith('pool/')) return lc.startsWith('application/octet-stream') || lc.startsWith('application/vnd.debian.binary-package');
    if (key.startsWith('dists/')) return ['text/plain', 'application/x-gzip', 'application/gzip', 'application/x-xz', 'application/octet-stream'].some(p => lc.startsWith(p));
    if (ALLOWED_EXACT.includes(key)) return lc.startsWith('text/plain') || lc.startsWith('application/octet-stream');
    return false;
}

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
            // scripts/install.sh / pubkey.asc — proxy pins Content-Type on GET,
            // so here we only accept text/plain-family + binary octet-stream
            // for tools that upload raw bytes.
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

export async function handleFinalize(req: Request, env: Bindings): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (!checkAuth(req, env)) return new Response('unauthorized', { status: 401 });

    const url = new URL(req.url);
    let rawPath: string;
    try {
        rawPath = decodeURIComponent(url.pathname.replace(/^\/api\/upload\//, '').replace(/\/finalize$/, ''));
    } catch {
        return new Response('Invalid path encoding', { status: 400 });
    }
    const validated = validateUploadPath(rawPath);
    if (!validated.ok) return new Response(`Bad Request: ${validated.error}`, { status: 400 });

    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });

    let body: { size: number; sha256: string };
    try {
        const text = await req.text();
        if (text.length > 64 * 1024) return new Response('Finalize body too large', { status: 413 });
        body = JSON.parse(text);
    } catch {
        return new Response('Invalid JSON body', { status: 400 });
    }
    if (!body || typeof body.size !== 'number' || !Number.isSafeInteger(body.size) || body.size <= 0) {
        return new Response('Invalid size', { status: 400 });
    }
    if (typeof body.sha256 !== 'string' || !SHA256_RE.test(body.sha256)) {
        return new Response('Invalid sha256', { status: 400 });
    }
    const expectedSha = body.sha256.toLowerCase();

    const head = await bucket.head(validated.key);
    if (!head) return new Response('Object not found in R2', { status: 404 });
    if (head.size !== body.size) {
        return new Response(`Size mismatch: R2=${head.size} claim=${body.size}`, { status: 400 });
    }
    const storedSha = head.customMetadata?.sha256?.toLowerCase();
    if (storedSha !== expectedSha) {
        return new Response(`sha256 mismatch: R2=${storedSha} claim=${expectedSha}`, { status: 400 });
    }

    if (isImmutable(validated.key)) {
        // Re-head to detect concurrent write races: a different etag with the
        // same metadata is the existing immutable object beating us to it.
        const recheck = await bucket.head(validated.key);
        if (recheck && recheck.etag !== head.etag && recheck.customMetadata?.sha256?.toLowerCase() === expectedSha) {
            // Concurrent writer with identical hash: idempotent OK.
        } else if (recheck && recheck.etag !== head.etag) {
            await bucket.delete(validated.key);
            return new Response('Immutable file differs; use a new package version', { status: 409 });
        }
    }
    return new Response('OK', { headers: { 'X-Content-SHA256': expectedSha } });
}

export async function handlePresign(req: Request, env: Bindings): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (!checkAuth(req, env)) return new Response('unauthorized', { status: 401 });

    const url = new URL(req.url);
    let rawPath: string;
    try {
        rawPath = decodeURIComponent(url.pathname.replace(/^\/api\/upload\//, '').replace(/\/presign$/, ''));
    } catch {
        return new Response('Invalid path encoding', { status: 400 });
    }

    const validated = validateUploadPath(rawPath);
    if (!validated.ok) return new Response(`Bad Request: ${validated.error}`, { status: 400 });

    let body: PresignBody;
    try {
        const text = await req.text();
        if (text.length > 64 * 1024) return new Response('Presign body too large', { status: 413 });
        body = JSON.parse(text);
    } catch {
        return new Response('Invalid JSON body', { status: 400 });
    }
    if (!body || typeof body.size !== 'number' || !Number.isSafeInteger(body.size) || body.size <= 0) {
        return new Response('Invalid size', { status: 400 });
    }
    if (typeof body.sha256 !== 'string' || !SHA256_RE.test(body.sha256)) {
        return new Response('Invalid sha256', { status: 400 });
    }
    if (body.size > R2_MAX_PUT_BYTES) {
        return new Response('Size exceeds 5 GB R2 single-PUT limit', { status: 413 });
    }

    const contentType = body.content_type || (validated.key.startsWith('pool/')
        ? 'application/octet-stream' : 'application/octet-stream');
    if (!allowedContentType(validated.key, contentType)) {
        return new Response(`Invalid Content-Type for ${validated.key}`, { status: 400 });
    }

    const accountId = env.R2_ACCOUNT_ID;
    const accessKeyId = env.R2_ACCESS_KEY_ID;
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
    const bucket = env.R2_BUCKET_NAME;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        return new Response('R2 SigV4 credentials not configured', { status: 500 });
    }

    const { url: signedUrl, headers, expiresAt } = await signR2PutUrl({
        accountId, bucket, key: validated.key,
        contentType, customMetadata: { sha256: body.sha256.toLowerCase() },
        expiresIn: 600, accessKeyId, secretAccessKey,
        extraSignedHeaders: isImmutable(validated.key) ? { 'If-None-Match': '*' } : undefined,
    });
    return Response.json({
        url: signedUrl,
        headers,
        expires_in: expiresAt - Math.floor(Date.now() / 1000),
    });
}
