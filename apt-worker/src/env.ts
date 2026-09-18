export interface PackageEntry {
    Package: string;
    Version: string;
    Architecture: string;
    Size: number;
    Filename: string;
    Description?: string;
    Depends?: string;
    Maintainer?: string;
    Section?: string;
    Priority?: string;
}

export type Bindings = {
    ASSETS?: Fetcher;
    APT_BUCKET?: R2Bucket;
    APT_KV?: KVNamespace;
    ADMIN_PUSH_TOKEN?: string;
    R2_ACCOUNT_ID?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    R2_BUCKET_NAME?: string;
};

export type AppEnv = {
    Bindings: Bindings;
};
