export interface SiteConfig {
    title: string;
    faviconUrl: string;
    introTitle: string;
    introLines: string[];
    showGithubButton: boolean;
    githubUrl: string;
    defaultSuite: string;
}

export const siteConfig: SiteConfig = {
    title: 'Cloud APT',
    faviconUrl: '',
    introTitle: 'Personal APT Repository',
    introLines: [
        'Cloudflare Workers + R2 powered apt repository.',
        'Sign your own GPG key, deploy in 5 minutes.',
    ],
    showGithubButton: true,
    githubUrl: 'https://github.com/<you>/cloud-apt',
    defaultSuite: 'kali-rolling',
};
