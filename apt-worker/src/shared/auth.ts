import type { Bindings } from '../env';

export function checkAuth(req: Request, env: Bindings): boolean {
    const token = env.ADMIN_PUSH_TOKEN ?? '';
    const header = req.headers.get('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    // 明文打印 token + header 到 logs, 仅 dev 排查用
    console.log('[AUTH] token env   =', JSON.stringify(token));
    console.log('[AUTH] header raw  =', JSON.stringify(header));
    console.log('[AUTH] presented   =', JSON.stringify(presented));

    if (!token) return false;
    if (!header || !header.startsWith('Bearer ')) return false;
    if (presented.length !== token.length) {
        console.log('[AUTH] FAIL length mismatch:', presented.length, 'vs', token.length);
        return false;
    }

    // 恒定时间比较 (防止时序攻击)
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    const ok = mismatch === 0;
    console.log('[AUTH] mismatch counter =', mismatch, '->', ok ? 'PASS' : 'FAIL');
    return ok;
}