import { describe, it, expect } from 'vitest';
import { validateUploadPath } from '../src/shared/path';

describe('validateUploadPath', () => {
    it('accepts dists/ prefix', () => {
        const r = validateUploadPath('dists/kali-rolling/Release');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.key).toBe('dists/kali-rolling/Release');
    });

    it('accepts pool/ prefix', () => {
        const r = validateUploadPath('pool/main/m/myapp/myapp_1.0_amd64.deb');
        expect(r.ok).toBe(true);
    });

    it('accepts pubkey.asc', () => {
        const r = validateUploadPath('pubkey.asc');
        expect(r.ok).toBe(true);
    });

    it('accepts scripts/install.sh', () => {
        const r = validateUploadPath('scripts/install.sh');
        expect(r.ok).toBe(true);
    });

    it('rejects path traversal', () => {
        expect(validateUploadPath('../etc/passwd').ok).toBe(false);
        expect(validateUploadPath('dists/../passwd').ok).toBe(false);
    });

    it('rejects absolute paths', () => {
        expect(validateUploadPath('/etc/passwd').ok).toBe(false);
    });

    it('rejects unknown prefix', () => {
        expect(validateUploadPath('foo/bar').ok).toBe(false);
    });

    it('rejects empty', () => {
        expect(validateUploadPath('').ok).toBe(false);
    });

    it('rejects directory-style dists/', () => {
        const r = validateUploadPath('dists/');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('Empty upload path');
    });

    it('rejects bare "dists" without trailing slash', () => {
        const r = validateUploadPath('dists');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('Empty upload path');
    });

    it('rejects bare "pool" without trailing slash', () => {
        const r = validateUploadPath('pool');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('Empty upload path');
    });

    it('rejects directory-style pool/', () => {
        const r = validateUploadPath('pool/');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('Empty upload path');
    });
});
