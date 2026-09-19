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

    <nav class="flex flex-wrap gap-2 mt-4 mb-2">
      <router-link
        v-for="t in tabs"
        :key="t.label"
        :to="t.query ? `/browse?suite=${suite}&arch=${t.query}` : `/browse?suite=${suite}`"
        :class="[
          'px-3 py-1.5 rounded-md border text-sm no-underline',
          activeArch === t.query
            ? 'bg-accent border-accent text-bg'
            : 'bg-card border-border text-accent hover:bg-hover'
        ]"
      >
        {{ t.label }}
      </router-link>
    </nav>

    <h2 class="text-base sm:text-lg mt-2 mb-2">
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

const tabs = [
  { label: 'all archs', query: '' },
  { label: 'amd64', query: 'amd64' },
  { label: 'arm64', query: 'arm64' },
  { label: 'all', query: 'all' },
];

const route = useRoute();
const suite = computed(() => (route.query.suite as string) || siteConfig.defaultSuite);
const activeArch = computed(() => (route.query.arch as string) || '');
const arch = computed<string | string[]>(() => {
    if (activeArch.value === 'amd64' || activeArch.value === 'arm64' || activeArch.value === 'all') return activeArch.value;
    return ['amd64', 'arm64', 'all'];
});
const archLabel = computed(() => Array.isArray(arch.value) ? 'all archs' : arch.value);

const { packages, loading, error } = usePackages(suite, arch);
</script>