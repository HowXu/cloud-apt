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

// 用于在 401 响应体里返回诊断信息 — dev 排查用,生产部署前必须移除.
export function authDebug(req: Request, env: Bindings): AuthDebug {
    const token = env.ADMIN_PUSH_TOKEN ?? '';
    const header = req.headers.get('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    if (!token) return { token, tokenLen: token.length, header, presented, presentedLen: presented.length, mismatch: null, fail: 'no token in env', pass: false };
    if (!header || !header.startsWith('Bearer ')) return { token, tokenLen: token.length, header, presented, presentedLen: presented.length, mismatch: null, fail: 'no/wrong Authorization header', pass: false };
    if (presented.length !== token.length) return { token, tokenLen: token.length, header, presented, presentedLen: presented.length, mismatch: null, fail: `length mismatch (${presented.length} vs ${token.length})`, pass: false };

    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    return {
        token, tokenLen: token.length, header, presented, presentedLen: presented.length,
        mismatch, fail: mismatch === 0 ? null : 'byte mismatch', pass: mismatch === 0,
    };
}

export function checkAuth(req: Request, env: Bindings): boolean {
    return authDebug(req, env).pass;
}