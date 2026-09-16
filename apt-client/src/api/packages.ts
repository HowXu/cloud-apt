import type { IndexResponse, PackageEntry } from '../types';

const BASE = '';

async function parseIndex(r: Response): Promise<PackageEntry[]> {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
        throw new Error(`expected JSON, got "${ct || 'no content-type'}" (HTTP ${r.status})`);
    }
    const json = (await r.json()) as IndexResponse;
    return json.packages ?? [];
}

export async function fetchIndex(suite: string, arch: string): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}`);
    return parseIndex(r);
}

export async function searchPackages(
    suite: string,
    arch: string,
    query: string
): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}/search?q=${encodeURIComponent(query)}`);
    return parseIndex(r);
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}