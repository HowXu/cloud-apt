import { Hono } from 'hono';
import type { Bindings } from './env';
import { proxyR2 } from './proxy';
import { handleUpload } from './upload';
import { handleIndex, handleSearch } from './api-index';
import { invalidate } from './cache';
import { checkAuth, authDebug } from './shared/auth';

const app = new Hono<{ Bindings: Bindings }>();

app.post('/api/invalidate', async (c) => {
    if (!checkAuth(c.req.raw, c.env)) {
        return c.json({ error: 'Unauthorized', ...authDebug(c.req.raw, c.env) }, 401);
    }
    const suite = c.req.query('suite');
    if (!suite) return c.text('Missing suite', 400);
    await invalidate(c.env, suite);
    return c.text('OK');
});

app.all('/api/upload/*', (c) => handleUpload(c.req.raw, c.env));

app.get('/api/index/:suite/:arch', (c) =>
    handleIndex(c.req.param('suite'), c.req.param('arch'), c.env)
);
app.get('/api/index/:suite/:arch/search', (c) =>
    handleSearch(c.req.param('suite'), c.req.param('arch'), c.req.query('q') || '', c.env)
);

app.get('/dists/*', (c) => proxyR2(c.env, c.req.path.slice(1)));
app.get('/pool/*', (c) => proxyR2(c.env, c.req.path.slice(1)));
app.get('/pubkey.asc', (c) => proxyR2(c.env, 'pubkey.asc', 'text/plain'));
app.get('/install.sh', (c) => proxyR2(c.env, 'scripts/install.sh', 'text/plain; charset=utf-8'));

app.get('/api/status/health', (c) => c.json({ status: 'ok' }));

app.get('*', async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dists/') ||
        url.pathname.startsWith('/pool/')) {
        return c.notFound();
    }
    if (!c.env.ASSETS) return c.text('SPA assets not built', { status: 500 });
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) {
        return res;
    }
    const h = new Headers(res.headers);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Frame-Options', 'DENY');
    h.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self';");
    return new Response(res.body, { status: res.status, headers: h });
});

export default app;