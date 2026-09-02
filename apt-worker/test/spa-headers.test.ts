import { describe, it, expect, vi } from 'vitest';
import app from '../src/index';

const mockAssets = (contentType: string, body: string) => ({
    fetch: vi.fn(async () =>
        new Response(body, {
            status: 200,
            headers: { 'Content-Type': contentType },
        })
    ),
});

describe('SPA security headers', () => {
    it('adds CSP and security headers to HTML responses', async () => {
        const env = {
            ASSETS: mockAssets('text/html; charset=utf-8', '<!doctype html><html></html>'),
        } as any;
        const res = await app.request('https://x/', {}, env);
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toBeTruthy();
        expect(csp).toContain("default-src 'self'");
    });

    it('passes through non-HTML responses unchanged', async () => {
        const env = {
            ASSETS: mockAssets('application/javascript', 'console.log(1);'),
        } as any;
        const res = await app.request('https://x/assets/main.js', {}, env);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/javascript');
        expect(res.headers.get('Content-Security-Policy')).toBeNull();
        expect(res.headers.get('X-Content-Type-Options')).toBeNull();
    });
});