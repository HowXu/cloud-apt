import type { PackageEntry } from '../types';

const BASE = '';

async function parseIndex(r: Response): Promise<PackageEntry[]> {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
        throw new Error(`expected JSON, got "${ct || 'no content-type'}" (HTTP ${r.status})`);
    }
    const json = (await r.json()) as { packages?: PackageEntry[] };
    return json.packages ?? [];
}

export async function fetchIndex(
    suite: string,
    arch: string | string[]
): Promise<PackageEntry[]> {
    const archs = Array.isArray(arch) ? arch : [arch];
    const lists = await Promise.all(
        archs.map((a) =>
            fetch(`${BASE}/api/index/${suite}/${a}`).then(parseIndex)
        )
    );
    return lists.flat();
}

export async function searchPackages(
    suite: string,
    arch: string | string[],
    query: string
): Promise<PackageEntry[]> {
    const archs = Array.isArray(arch) ? arch : [arch];
    const lists = await Promise.all(
        archs.map((a) =>
            fetch(
                `${BASE}/api/index/${suite}/${a}/search?q=${encodeURIComponent(query)}`
            ).then(parseIndex)
        )
    );
    return lists.flat();
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}