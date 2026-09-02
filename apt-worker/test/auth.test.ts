import { describe, it, expect } from 'vitest';
import { checkAuth } from '../src/shared/auth';
import type { Bindings } from '../src/env';

const env = (token?: string): Bindings => ({ ADMIN_PUSH_TOKEN: token });

describe('checkAuth', () => {
    it('passes with valid Bearer token', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Bearer secret-123' },
        });
        expect(checkAuth(req, env('secret-123'))).toBe(true);
    });

    it('rejects missing header', () => {
        const req = new Request('https://x/');
        expect(checkAuth(req, env('secret-123'))).toBe(false);
    });

    it('rejects wrong scheme', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Basic secret-123' },
        });
        expect(checkAuth(req, env('secret-123'))).toBe(false);
    });

    it('rejects wrong token', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Bearer wrong' },
        });
        expect(checkAuth(req, env('secret-123'))).toBe(false);
    });

    it('rejects when env token not set', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Bearer secret-123' },
        });
        expect(checkAuth(req, env(undefined))).toBe(false);
    });
});