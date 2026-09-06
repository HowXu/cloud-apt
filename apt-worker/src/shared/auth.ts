import type { Bindings } from '../env';

export interface AuthDebug {
    token: string;
    tokenLen: number;
    header: string;
    presented: string;
    presentedLen: number;
    mismatch: number | null;   // null = length mismatch (no compare run)
    fail: string | null;       // first reason checkAuth returned false
    pass: boolean;
}

function dump(label: string, d: AuthDebug): void {
    console.log(`[AUTH ${label}] pass=${d.pass} fail=${d.fail ?? '-'} mismatch=${d.mismatch ?? '-'} ` +
        `tokenLen=${d.tokenLen} presentedLen=${d.presentedLen} ` +
        `token=${JSON.stringify(d.token)} presented=${JSON.stringify(d.presented)}`);
}

// 用于在 401 响应体里返回诊断信息 — dev 排查用,生产部署前必须移除.
export function authDebug(req: Request, env: Bindings): AuthDebug {
    const token = env.ADMIN_PUSH_TOKEN ?? '';
    const header = req.headers.get('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    if (!token) {
        const d: AuthDebug = { token, tokenLen: token.length, header, presented, presentedLen: presented.length, mismatch: null, fail: 'no token in env', pass: false };
        dump('FAIL no-token', d); return d;
    }
    if (!header || !header.startsWith('Bearer ')) {
        const d: AuthDebug = { token, tokenLen: token.length, header, presented, presentedLen: presented.length, mismatch: null, fail: 'no/wrong Authorization header', pass: false };
        dump('FAIL header', d); return d;
    }
    if (presented.length !== token.length) {
        const d: AuthDebug = { token, tokenLen: token.length, header, presented, presentedLen: presented.length, mismatch: null, fail: `length mismatch (${presented.length} vs ${token.length})`, pass: false };
        dump('FAIL len', d); return d;
    }

    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    const d: AuthDebug = {
        token, tokenLen: token.length, header, presented, presentedLen: presented.length,
        mismatch, fail: mismatch === 0 ? null : 'byte mismatch', pass: mismatch === 0,
    };
    dump(mismatch === 0 ? 'PASS' : 'FAIL byte', d);
    return d;
}

export function checkAuth(req: Request, env: Bindings): boolean {
    return authDebug(req, env).pass;
}