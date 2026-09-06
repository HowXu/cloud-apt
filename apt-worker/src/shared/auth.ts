import type { Bindings } from '../env';

// DEBUG_AUTH=1: 在 wrangler dev / Workers Logs 里打印 token 和 header
// ⚠ 严禁带到生产环境 — ADMIN_PUSH_TOKEN 是管理员凭据, 一旦日志被聚合
// 留存就是凭证泄漏. 仅 dev / 临时排查用, 排查完立即 set 回空.
function debugAuth(env: Bindings, presented: string | null, mismatch: number): void {
    const flag = (env as any).DEBUG_AUTH;
    if (flag !== '1' && flag !== 'true') return;

    const token = env.ADMIN_PUSH_TOKEN ?? '';
    const tokenPreview = token ? `${token.slice(0, 4)}…${token.slice(-4)} (len=${token.length})` : '(unset)';
    const presentedPreview = presented === null
        ? '(no header)'
        : presented === ''
            ? '(empty Bearer)'
            : `${presented.slice(0, 4)}…${presented.slice(-4)} (len=${presented.length})`;

    console.log('[DEBUG_AUTH] env.ADMIN_PUSH_TOKEN =', tokenPreview);
    console.log('[DEBUG_AUTH] presented            =', presentedPreview);
    console.log('[DEBUG_AUTH] mismatch counter    =', mismatch);
    // ⚠ 全量打印 — 仅当 DEBUG_AUTH_FULL=1
    const full = (env as any).DEBUG_AUTH_FULL;
    if (full === '1' || full === 'true') {
        console.log('[DEBUG_AUTH] FULL TOKEN       =', JSON.stringify(token));
        console.log('[DEBUG_AUTH] FULL PRESENTED   =', JSON.stringify(presented));
    }
}

export function checkAuth(req: Request, env: Bindings): boolean {
    const token = env.ADMIN_PUSH_TOKEN;
    if (!token) {
        debugAuth(env, null, 0);
        return false;
    }

    const header = req.headers.get('Authorization');
    if (!header) {
        debugAuth(env, null, 0);
        return false;
    }
    if (!header.startsWith('Bearer ')) {
        debugAuth(env, header.slice(0, 16), 0);
        return false;
    }

    const presented = header.slice('Bearer '.length);

    // 恒定时间比较 (防止时序攻击)
    if (presented.length !== token.length) {
        debugAuth(env, presented, -1);
        return false;
    }
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    const ok = mismatch === 0;
    debugAuth(env, presented, mismatch);
    return ok;
}