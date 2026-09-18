import { AwsClient } from 'aws4fetch';

export interface SignR2PutUrlInput {
    accountId: string;
    bucket: string;
    key: string;
    contentType: string;
    customMetadata: Record<string, string>;
    expiresIn: number;
    accessKeyId: string;
    secretAccessKey: string;
    now?: () => number;
}

export interface SignR2PutUrlResult {
    url: string;
    headers: Record<string, string>;
    expiresAt: number;
}

const R2_REGION = 'auto';

export async function signR2PutUrl(input: SignR2PutUrlInput): Promise<SignR2PutUrlResult> {
    const endpoint = `https://${input.accountId}.r2.cloudflarestorage.com`;
    const url = `${endpoint}/${encodeURIComponent(input.bucket)}/${input.key.split('/').map(encodeURIComponent).join('/')}`;
    const headers: Record<string, string> = {
        'Content-Type': input.contentType,
        ...Object.fromEntries(
            Object.entries(input.customMetadata).map(([k, v]) => [`x-amz-meta-${k.toLowerCase()}`, v]),
        ),
    };
    const epochMs = (input.now ?? Date.now)();
    const datetime = new Date(epochMs).toISOString().replace(/[:-]|\.\d{3}/g, '');
    const urlObj = new URL(url);
    urlObj.searchParams.set('X-Amz-Expires', String(input.expiresIn));
    const client = new AwsClient({
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        service: 's3',
        region: R2_REGION,
    });
    const signed = await client.sign(
        new Request(urlObj.toString(), { method: 'PUT', headers }),
        { aws: { signQuery: true, datetime } },
    );
    const expiresAt = Math.floor(epochMs / 1000) + input.expiresIn;
    return { url: signed.url, headers, expiresAt };
}