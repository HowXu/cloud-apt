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

export interface IndexResponse {
    packages: PackageEntry[];
}
