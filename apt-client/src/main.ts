import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { siteConfig } from './site.config';
import 'virtual:uno.css';
import '@unocss/reset/tailwind.css';

import HomePage from './pages/HomePage.vue';
import BrowsePage from './pages/BrowsePage.vue';
import PackagePage from './pages/PackagePage.vue';
import SearchPage from './pages/SearchPage.vue';

document.title = siteConfig.browserTabTitle || siteConfig.headerTitle;
if (siteConfig.iconUrl) {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
        ?? document.createElement('link');
    link.rel = 'icon';
    link.href = siteConfig.iconUrl;
    if (!link.isConnected) document.head.appendChild(link);
}

const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/', component: HomePage },
        { path: '/browse', component: BrowsePage },
        { path: '/browse/:pkg', component: PackagePage, props: true },
        { path: '/search', component: SearchPage },
    ],
});

createApp(App).use(router).mount('#app');