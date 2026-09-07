import type { Bindings } from '../env';

export function checkAuth(req: Request, env: Bindings): boolean {
    const token = env.ADMIN_PUSH_TOKEN;
    if (!token) return false;

    const header = req.headers.get('Authorization');
    if (!header) return false;
    if (!header.startsWith('Bearer ')) return false;

    const presented = header.slice('Bearer '.length);

    // 时序攻击
    if (presented.length !== token.length) return false;
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    return mismatch === 0;
}