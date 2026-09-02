import type { Bindings } from './env';
import { checkAuth } from './shared/auth';
import { validateUploadPath } from './shared/path';

export async function handleUpload(req: Request, env: Bindings): Promise<Response> {
    if (req.method !== 'PUT' && req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!checkAuth(req, env)) {
        return new Response('Unauthorized', { status: 401 });
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
        const body = await req.text();
        await bucket.put(validated.key, body, {
            httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' },
        });
    } else {
        await bucket.delete(validated.key);
    }

    return new Response('OK', { status: 200 });
}