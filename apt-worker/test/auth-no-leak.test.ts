import { describe, it, expect } from 'vitest';
import { handleUpload } from '../src/upload';
import authSrc from '../src/shared/auth.ts?raw';
import uploadSrc from '../src/upload.ts?raw';
import indexSrc from '../src/index.ts?raw';

const FORBIDDEN = [
    /console\.(log|warn|error)\s*\([^)]*(token|TOKEN|PUSH|BEARER|DEBUG|MISMATCH)/i,
    /JSON\.stringify\([^)]*token/i,
    /\{\s*error\s*:\s*['"]unauthorized['"][^}]*token/i,
];

const FILES: { rel: string; src: string }[] = [
    { rel: 'apt-worker/src/shared/auth.ts', src: authSrc },
    { rel: 'apt-worker/src/upload.ts', src: uploadSrc },
    { rel: 'apt-worker/src/index.ts', src: indexSrc },
];

describe('no token leak via console or 401 body', () => {
    for (const { rel, src } of FILES) {
        it(`${rel} contains no forbidden logging`, () => {
            for (const re of FORBIDDEN) {
                expect(src).not.toMatch(re);
            }
        });
    }

    it('upload.ts 401 body is plain text', async () => {
        const env = { ADMIN_PUSH_TOKEN: 'x'.repeat(64), APT_BUCKET: fakeBucket() } as any;
        const req = new Request('http://localhost/api/upload/dists/foo', {
            method: 'PUT',
            headers: { authorization: 'Bearer wrong' },
        });
        const res = await handleUpload(req, env);
        expect(res.status).toBe(401);
        const body = await res.text();
        expect(body).toBe('unauthorized');
    });
});

function fakeBucket() {
    return { put: async () => undefined, delete: async () => undefined, get: async () => null, head: async () => null } as any;
}
