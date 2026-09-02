<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/" class="text-accent no-underline hover:underline">← home</router-link></p>

    <SearchBox :placeholder="`Search: ${query}`" />

    <h2 class="text-lg mt-4 mb-2">Search: {{ query }} · {{ results.length }} results</h2>

    <div v-if="loading" class="text-muted">Searching…</div>
    <PackageTable v-else :packages="results" />

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { siteConfig } from '../site.config';
import { searchPackages } from '../api/packages';
import type { PackageEntry } from '../types';
import SearchBox from '../components/SearchBox.vue';
import PackageTable from '../components/PackageTable.vue';
import Footer from '../components/Footer.vue';

const route = useRoute();
const query = ref((route.query.q as string) || '');
const results = ref<PackageEntry[]>([]);
const loading = ref(false);

async function doSearch() {
    if (!query.value) {
        results.value = [];
        return;
    }
    loading.value = true;
    try {
        results.value = await searchPackages(siteConfig.defaultSuite, 'amd64', query.value);
    } finally {
        loading.value = false;
    }
}

watch(query, doSearch, { immediate: true });
watch(() => route.query.q, (q) => {
    query.value = (q as string) || '';
});
</script>