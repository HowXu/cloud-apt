import { describe, it, expect } from 'vitest';
import { parsePackages } from '../src/parser';

const sample = `Package: myapp
Version: 1.2.3
Architecture: amd64
Size: 1234567
Filename: pool/main/m/myapp/myapp_1.2.3_amd64.deb
Description: My custom app
Depends: libc6 (>= 2.34), libssl3

Package: another
Version: 0.1.0
Architecture: arm64
Size: 500000
Filename: pool/main/a/another/another_0.1.0_arm64.deb
`;

describe('parsePackages', () => {
    it('parses multiple entries', () => {
        expect(parsePackages(sample)).toHaveLength(2);
    });

    it('extracts fields', () => {
        const [a] = parsePackages(sample);
        expect(a.Package).toBe('myapp');
        expect(a.Version).toBe('1.2.3');
        expect(a.Architecture).toBe('amd64');
        expect(a.Size).toBe(1234567);
        expect(a.Filename).toBe('pool/main/m/myapp/myapp_1.2.3_amd64.deb');
        expect(a.Description).toBe('My custom app');
        expect(a.Depends).toBe('libc6 (>= 2.34), libssl3');
    });

    it('handles empty input', () => {
        expect(parsePackages('')).toEqual([]);
    });

    it('handles multi-line Description continuation', () => {
        const text = `Package: x
Version: 1
Architecture: amd64
Filename: p
Description: line one
 line two
`;
        const [a] = parsePackages(text);
        expect(a.Description).toBe('line one line two');
    });
});
