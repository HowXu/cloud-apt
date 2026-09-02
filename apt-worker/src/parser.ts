import type { PackageEntry } from './env';

const OPTIONAL_FIELDS = ['Description', 'Depends', 'Maintainer', 'Section', 'Priority'] as const;

export function parsePackages(text: string): PackageEntry[] {
    const entries: PackageEntry[] = [];
    for (const block of text.split(/\n\n+/)) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        const fields: Record<string, string> = {};
        let currentKey = '';
        let currentValue = '';

        for (const line of trimmed.split('\n')) {
            if (/^\s/.test(line) && currentKey) {
                currentValue += ' ' + line.trim();
            } else {
                if (currentKey) fields[currentKey] = currentValue;
                const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
                if (m) {
                    currentKey = m[1];
                    currentValue = m[2];
                }
            }
        }
        if (currentKey) fields[currentKey] = currentValue;

        if (!fields.Package || !fields.Version || !fields.Architecture || !fields.Filename) continue;

        const entry: PackageEntry = {
            Package: fields.Package,
            Version: fields.Version,
            Architecture: fields.Architecture,
            Size: parseInt(fields.Size || '0', 10),
            Filename: fields.Filename,
        };
        for (const f of OPTIONAL_FIELDS) {
            if (fields[f]) (entry as any)[f] = fields[f];
        }
        entries.push(entry);
    }
    return entries;
}
