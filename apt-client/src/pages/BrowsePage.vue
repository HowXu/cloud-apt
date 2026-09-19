<template>
  <div class="max-w-1280px mx-auto px-4 py-6 sm:px-8 sm:py-8">
    <header class="flex items-center mb-6 sm:mb-8 gap-3">
      <img
        v-if="siteConfig.iconUrl"
        :src="siteConfig.iconUrl"
        :alt="siteConfig.iconAlt || ''"
        class="h-7 w-7"
      />
      <h1 class="text-xl sm:text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.headerTitle }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/" class="text-accent no-underline hover:underline">← home</router-link></p>
    <h2 class="text-base sm:text-lg mt-4 mb-2">
      {{ suite }} · {{ archLabel }} · {{ packages.length }} packages
    </h2>

    <div v-if="loading" class="text-muted">Loading…</div>
    <div v-else-if="error" class="text-red-400">Error: {{ error.message }}</div>
    <PackageTable v-else :packages="packages" />

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { siteConfig } from '../site.config';
import { usePackages } from '../composables/usePackages';
import PackageTable from '../components/PackageTable.vue';
import Footer from '../components/Footer.vue';

const route = useRoute();
const suite = computed(() => (route.query.suite as string) || siteConfig.defaultSuite);
const arch = computed<string | string[]>(() => {
    const a = route.query.arch as string | undefined;
    if (a === 'amd64' || a === 'arm64' || a === 'all') return a;
    return ['amd64', 'arm64', 'all'];
});
const archLabel = computed(() => Array.isArray(arch.value) ? 'all archs' : arch.value);

const { packages, loading, error } = usePackages(suite, arch);
</script>