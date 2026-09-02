import type { Bindings, PackageEntry } from './env';

const TTL_SECONDS = 300;
const ARCHS = ['amd64', 'arm64'] as const;
type Arch = typeof ARCHS[number];

function key(suite: string, arch: Arch): string {
    return `idx:${suite}:${arch}`;
}

export async function getCachedIndex(
    env: Bindings,
    suite: string,
    arch: Arch
): Promise<PackageEntry[] | null> {
    const kv = env.APT_KV;
    if (!kv) return null;
    const v = await kv.get(key(suite, arch));
    if (!v) return null;
    try {
        return JSON.parse(v);
    } catch {
        return null;
    }
}

export async function setCachedIndex(
    env: Bindings,
    suite: string,
    arch: Arch,
    entries: PackageEntry[]
): Promise<void> {
    const kv = env.APT_KV;
    if (!kv) return;
    await kv.put(key(suite, arch), JSON.stringify(entries), { expirationTtl: TTL_SECONDS });
}

export async function invalidate(env: Bindings, suite: string): Promise<void> {
    const kv = env.APT_KV;
    if (!kv) return;
    await Promise.all(ARCHS.map((a) => kv.delete(key(suite, a))));
}