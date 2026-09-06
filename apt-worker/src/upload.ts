import type { Bindings } from './env';
import { checkAuth, authDebug } from './shared/auth';
import { validateUploadPath, ALLOWED_EXACT } from './shared/path';

export async function handleUpload(req: Request, env: Bindings): Promise<Response> {
    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/^\/api\/upload\//, '');
    console.log(`[UPLOAD] method=${req.method} path=${JSON.stringify(rawPath)} ct=${JSON.stringify(req.headers.get('Content-Type'))}`);

    if (req.method !== 'PUT' && req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!checkAuth(req, env)) {
        // dev 排查: 401 响应体里返回 token/presented/mismatch, 生产部署前必须改回 'Unauthorized'
        return Response.json({ error: 'Unauthorized', ...authDebug(req, env) }, { status: 401 });
    }

    const validated = validateUploadPath(rawPath);
    if (!validated.ok) {
        console.log(`[UPLOAD] 400 PATH FAIL: ${validated.error}`);
        return new Response(`Bad Request: ${validated.error}`, { status: 400 });
    }

    const bucket = env.APT_BUCKET;
    if (!bucket) {
        console.log('[UPLOAD] 500 R2 not bound');
        return new Response('R2 not bound', { status: 500 });
    }

    if (req.method === 'PUT') {
        const contentType = req.headers.get('Content-Type') || 'application/octet-stream';
        let allowed: string[];
        if (validated.key.startsWith('pool/')) {
            allowed = ['application/octet-stream', 'application/vnd.debian.binary-package'];
        } else if (validated.key.startsWith('dists/')) {
            allowed = ['text/plain', 'application/x-gzip', 'application/gzip', 'application/x-xz', 'application/octet-stream'];
        } else if (ALLOWED_EXACT.includes(validated.key)) {
            // scripts/install.sh / pubkey.asc — proxy 在 GET 端已 pin Content-Type,
            // 这里只允许 text/plain 系 + binary (供某些自动化工具用 octet-stream 上传)
            allowed = ['text/plain', 'text/plain; charset=utf-8', 'application/octet-stream'];
        } else {
            console.log(`[UPLOAD] 400 PATH NOT IN EXACT/PREFIX: ${validated.key}`);
            return new Response('Invalid upload path', { status: 400 });
        }
        const ok = allowed.some(p => contentType.toLowerCase().startsWith(p));
        console.log(`[UPLOAD] content-type check: ct=${JSON.stringify(contentType)} allowed=${JSON.stringify(allowed)} match=${ok}`);
        if (!ok) {
            return new Response(`Invalid Content-Type for ${validated.key}`, { status: 400 });
        }
        const body = await req.arrayBuffer();
        await bucket.put(validated.key, body, { httpMetadata: { contentType } });
        console.log(`[UPLOAD] PUT ok: ${validated.key} (${body.byteLength} bytes)`);
    } else {
        await bucket.delete(validated.key);
        console.log(`[UPLOAD] DELETE ok: ${validated.key}`);
    }

    return new Response('OK', { status: 200 });
}