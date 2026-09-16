export interface UsageStep {
    title: string;
    code: string;
    note?: string;
}

export interface SiteConfig {
    headerTitle: string;
    headerTagline?: string;
    browserTabTitle?: string;
    iconUrl?: string;
    iconAlt?: string;
    homepageIntroLines: string[];
    usageSteps: UsageStep[];
    showGithubButton: boolean;
    githubUrl: string;
    defaultSuite: string;
}

export const siteConfig: SiteConfig = {
    headerTitle: 'Cloud APT',
    headerTagline: '',
    browserTabTitle: 'Cloud APT',
    iconUrl: '',
    iconAlt: '',
    homepageIntroLines: [
        'Cloudflare Workers + R2 powered apt repository.',
        'Sign your own GPG key, deploy in 5 minutes.',
    ],
    usageSteps: [
        { title: '1. Add the repository',
          code: 'deb https://<your-worker-domain> kali-rolling main' },
        { title: '2. Update package index',
          code: 'sudo apt update' },
        { title: '3. Install a package',
          code: 'sudo apt install <package-name>' },
    ],
    showGithubButton: true,
    githubUrl: 'https://github.com/HowXu/cloud-apt',
    defaultSuite: 'kali-rolling',
};