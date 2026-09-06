import type { Bindings } from './env';
import { checkAuth, authDebug } from './shared/auth';
import { validateUploadPath } from './shared/path';

export async function handleUpload(req: Request, env: Bindings): Promise<Response> {
    if (req.method !== 'PUT' && req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!checkAuth(req, env)) {
        // dev 排查: 401 响应体里返回 token/presented/mismatch, 生产部署前必须改回 'Unauthorized'
        return Response.json({ error: 'Unauthorized', ...authDebug(req, env) }, { status: 401 });
    }

    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/^\/api\/upload\//, '');

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
        } else {
            return new Response('Invalid upload path', { status: 400 });
        }
        if (!allowed.some(p => contentType.toLowerCase().startsWith(p))) {
            return new Response(`Invalid Content-Type for ${validated.key}`, { status: 400 });
        }
        const body = await req.arrayBuffer();
        await bucket.put(validated.key, body, { httpMetadata: { contentType } });
    } else {
        await bucket.delete(validated.key);
    }

    return new Response('OK', { status: 200 });
}