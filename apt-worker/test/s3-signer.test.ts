import { describe, it, expect } from 'vitest';
import { signR2PutUrl } from '../src/shared/s3-signer';

const FIXED_NOW = 1_700_000_000; // 2023-11-14T22:13:20Z, deterministic
const inputs = {
    accountId: 'a' .repeat(32),
    bucket: 'cloud-apt',
    key: 'pool/main/l/linux/linux_1.0_amd64.deb',
    contentType: 'application/octet-stream',
    customMetadata: { sha256: 'b'.repeat(64) },
    expiresIn: 600,
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    now: () => FIXED_NOW * 1000,
};

describe('signR2PutUrl', () => {
    it('returns https URL against the R2 account endpoint', async () => {
        const { url } = await signR2PutUrl(inputs);
        expect(url.startsWith(`https://${inputs.accountId}.r2.cloudflarestorage.com/${inputs.bucket}/${inputs.key}?`)).toBe(true);
    });

    it('includes signed headers for Content-Type and x-amz-meta-sha256', async () => {
        const { headers } = await signR2PutUrl(inputs);
        expect(headers['Content-Type']).toBe(inputs.contentType);
        expect(headers['x-amz-meta-sha256']).toBe(inputs.customMetadata.sha256);
    });

    it('sets X-Amz-Expires to the requested window and Date is derived from now()', async () => {
        const { url } = await signR2PutUrl(inputs);
        const params = new URL(url).searchParams;
        expect(params.get('X-Amz-Expires')).toBe('600');
        expect(params.get('X-Amz-Date')).toBe('20231114T221320Z');
    });

    it('produces a stable URL for stable inputs', async () => {
        const a = await signR2PutUrl(inputs);
        const b = await signR2PutUrl(inputs);
        expect(a.url).toBe(b.url);
    });

    it('different customMetadata produces a different signature', async () => {
        const a = await signR2PutUrl(inputs);
        const b = await signR2PutUrl({ ...inputs, customMetadata: { sha256: 'c'.repeat(64) } });
        expect(a.url).not.toBe(b.url);
    });

    it('signs extra headers into the URL', async () => {
        const { url, headers } = await signR2PutUrl({ ...inputs, extraSignedHeaders: { 'If-None-Match': '*' } });
        expect(headers['If-None-Match']).toBe('*');
        const { url: url2 } = await signR2PutUrl({ ...inputs, extraSignedHeaders: { 'If-None-Match': '"abc"' } });
        expect(url2).not.toBe(url);
    });
});