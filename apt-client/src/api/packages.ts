import type { IndexResponse, PackageEntry } from '../types';

const BASE = '';

export async function fetchIndex(suite: string, arch: string): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}`);
    if (!r.ok) throw new Error(`fetchIndex failed: ${r.status}`);
    const json = (await r.json()) as IndexResponse;
    return json.packages;
}

export async function searchPackages(
    suite: string,
    arch: string,
    query: string
): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}/search?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(`searchPackages failed: ${r.status}`);
    const json = (await r.json()) as IndexResponse;
    return json.packages;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}