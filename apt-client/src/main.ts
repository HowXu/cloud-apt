import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import 'virtual:uno.css';
import '@unocss/reset/tailwind.css';

import HomePage from './pages/HomePage.vue';
import BrowsePage from './pages/BrowsePage.vue';
import PackagePage from './pages/PackagePage.vue';
import SearchPage from './pages/SearchPage.vue';

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
