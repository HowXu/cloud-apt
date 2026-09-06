export const ALLOWED_PREFIXES = ['dists/', 'pool/'];
export const ALLOWED_EXACT = ['pubkey.asc', 'scripts/install.sh', 'scripts/uninstall.sh'];

const SUITE_RE = /^[a-z0-9][a-z0-9.+~-]{0,63}$/;

export function validateSuite(s: string): boolean {
    return typeof s === 'string' && SUITE_RE.test(s);
}

function isPathSafe(p: string): boolean {
    if (!p) return false;
    if (p.startsWith('/')) return false;
    if (p.includes('..')) return false;
    if (p.includes('\0')) return false;
    return true;
}

export function validateUploadPath(
    path: string
): { ok: true; key: string } | { ok: false; error: string } {
    if (!isPathSafe(path)) {
        return { ok: false, error: 'Path is unsafe (traversal/absolute/null)' };
    }
    if (ALLOWED_EXACT.includes(path)) {
        return { ok: true, key: path };
    }
    for (const prefix of ALLOWED_PREFIXES) {
        if (path === prefix.replace(/\/$/, '')) {
            return { ok: false, error: 'Empty upload path' };
        }
        if (path.startsWith(prefix)) {
            if (path === prefix) {
                return { ok: false, error: 'Empty upload path' };
            }
            if (path.length > prefix.length) {
                return { ok: true, key: path };
            }
        }
    }
    return { ok: false, error: `Path not in whitelist. Allowed: ${[...ALLOWED_PREFIXES, ...ALLOWED_EXACT].join(', ')}` };
}
