<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/browse" class="text-accent no-underline hover:underline">← all packages</router-link></p>

    <div v-if="loading" class="text-muted">Loading…</div>
    <div v-else-if="error" class="text-red-400">Error: {{ error.message }}</div>
    <div v-else-if="!versions.length" class="text-muted">Package not found</div>
    <div v-else>
      <h2 class="text-lg mt-4">{{ pkg }}</h2>
      <p v-if="latest?.Description" class="text-muted">{{ latest.Description }}</p>

      <h3 class="text-base mt-8 mb-2">Versions ({{ versions.length }})</h3>
      <table class="w-full border-collapse">
        <thead>
          <tr class="text-muted text-sm">
            <th class="text-left px-3 py-2 border-b border-border">Version</th>
            <th class="text-left px-3 py-2 border-b border-border">Arch</th>
            <th class="text-left px-3 py-2 border-b border-border">Size</th>
            <th class="text-left px-3 py-2 border-b border-border"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in versions" :key="`${v.Version}-${v.Architecture}`" class="hover:bg-hover">
            <td class="px-3 py-2 font-mono text-sm">{{ v.Version }}</td>
            <td class="px-3 py-2 font-mono text-sm">{{ v.Architecture }}</td>
            <td class="px-3 py-2">{{ formatSize(v.Size) }}</td>
            <td class="px-3 py-2">
              <a :href="`/${v.Filename}`" class="text-accent no-underline hover:underline" download>Download .deb</a>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="text-base mt-8 mb-2">Metadata</h3>
      <dl class="grid grid-cols-[max-content_1fr] gap-2 gap-x-4 mt-4">
        <template v-if="latest?.Maintainer">
          <dt class="text-muted">Maintainer</dt>
          <dd>{{ latest.Maintainer }}</dd>
        </template>
        <template v-if="latest?.Depends">
          <dt class="text-muted">Depends</dt>
          <dd class="font-mono text-sm">{{ latest.Depends }}</dd>
        </template>
      </dl>
    </div>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { siteConfig } from '../site.config';
import { usePackages } from '../composables/usePackages';
import { formatSize } from '../api/packages';
import Footer from '../components/Footer.vue';

const route = useRoute();
const pkg = computed(() => decodeURIComponent((route.params.pkg as string) || ''));

const suite = computed(() => siteConfig.defaultSuite);
const arch = computed(() => 'amd64');  // 简化: 只查 amd64, 显示所有 arch

const { packages, loading, error } = usePackages(suite, arch);

const versions = computed(() =>
    packages.value
        .filter((p) => p.Package === pkg.value)
        .sort((a, b) => b.Version.localeCompare(a.Version))
);
const latest = computed(() => versions.value[0]);
</script>