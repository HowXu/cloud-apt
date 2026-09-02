<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/" class="text-accent no-underline hover:underline">← home</router-link></p>
    <h2 class="text-lg mt-4 mb-2">
      {{ suite }} · {{ arch }} · {{ packages.length }} packages
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
const arch = computed(() => (route.query.arch as string) || 'amd64');

const { packages, loading, error } = usePackages(suite, arch);
</script>