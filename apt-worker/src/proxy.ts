import type { Bindings } from './env';
import { resolveIndexKey } from './releases';

export async function proxyR2(
    env: Bindings,
    key: string,
    contentType?: string
): Promise<Response> {
    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });
    try {
        key = decodeURIComponent(key);
    } catch {
        return new Response('Invalid path encoding', { status: 400 });
    }

    // Snapshot paths are private staging storage, never public download URLs.
    if (key.includes('/.snapshots/')) return new Response('Not Found', { status: 404 });
    const obj = await bucket.get(await resolveIndexKey(bucket, key));
    if (!obj) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Cache-Control', key.includes('/by-hash/')
        ? 'public, max-age=31536000, immutable'
        : key.startsWith('dists/') ? 'no-store' : 'public, max-age=300');
    if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(obj.body, { headers });
}
