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
    headerTitle: 'Cloud APT Repository',
    headerTagline: '',
    browserTabTitle: 'Cloud APT Repository',
    iconUrl: 'https://q1.qlogo.cn/g?b=qq&nk=672252397&s=640',
    iconAlt: '',
    homepageIntroLines: [
        'Cloudflare drived apt repository.',
        'sign your own GPG key, deploy your repository',
    ],
    usageSteps: [
        { title: 'Add the repository and secret',
            code: 'curl -fsSL https://apt-repo.howxu.cn/install.sh | sudo bash' },
        { title: 'Update package index',
          code: 'sudo apt update' },
        { title: 'Install a package',
          code: 'sudo apt install <package-name>' },
    ],
    showGithubButton: true,
    githubUrl: 'https://github.com/HowXu/cloud-apt',
    defaultSuite: 'kali-rolling',
};