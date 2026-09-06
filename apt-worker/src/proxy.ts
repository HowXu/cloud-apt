import type { Bindings } from './env';

export async function proxyR2(
    env: Bindings,
    key: string,
    contentType?: string
): Promise<Response> {
    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });

    const obj = await bucket.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=300');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(obj.body, { headers });
}