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

    <p class="text-muted"><router-link to="/browse" class="text-accent no-underline hover:underline">← all packages</router-link></p>

    <div v-if="loading" class="text-muted">Loading…</div>
    <div v-else-if="error" class="text-red-400">Error: {{ error.message }}</div>
    <div v-else-if="!versions.length" class="text-muted">Package not found</div>
    <div v-else>
      <h2 class="text-base sm:text-lg mt-4 break-all">{{ pkg }}</h2>
      <p v-if="latest?.Description" class="text-muted mt-3 leading-relaxed">{{ latest.Description }}</p>

      <h3 class="text-base mt-6 sm:mt-8 mb-2">Versions ({{ versions.length }})</h3>
      <div class="version-list">
        <div
          v-for="v in versions"
          :key="`${v.Version}-${v.Architecture}`"
          class="version-row"
        >
          <span class="version-main">
            <span class="font-mono truncate">{{ v.Version }}</span>
            <span class="version-meta md:hidden">
              <span class="mx-1.5 text-muted">·</span>{{ v.Architecture }}
              <span class="mx-1.5 text-muted">·</span>{{ formatSize(v.Size) }}
            </span>
          </span>
          <span class="hidden text-right font-mono text-sm md:block">{{ v.Architecture }}</span>
          <span class="hidden text-right text-sm md:block">{{ formatSize(v.Size) }}</span>
          <div class="version-actions">
            <a :href="`/${v.Filename}`" class="download-link" download>download</a>
          </div>
        </div>
      </div>

      <h3 class="text-base mt-6 sm:mt-8 mb-2">Metadata</h3>
      <dl class="grid grid-cols-[max-content_1fr] gap-2 gap-x-4 mt-4">
        <template v-if="latest?.Maintainer">
          <dt class="text-muted">Maintainer</dt>
          <dd>{{ latest.Maintainer }}</dd>
        </template>
        <template v-if="latest?.Depends">
          <dt class="text-muted">Depends</dt>
          <dd class="font-mono text-sm break-all">{{ latest.Depends }}</dd>
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
const arch = computed(() => ['amd64', 'arm64', 'all']);

const { packages, loading, error } = usePackages(suite, arch);

const versions = computed(() =>
    packages.value
        .filter((p) => p.Package === pkg.value)
        .sort((a, b) => b.Version.localeCompare(a.Version))
);
const latest = computed(() => versions.value[0]);
</script>

<style scoped>
.version-list {
  min-width: 0;
  max-width: 100%;
  border-top: 1px solid #2a2e35;
}

.version-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem 1rem;
  min-height: 3rem;
  padding: 0.6rem 0.25rem;
  border-bottom: 1px solid #2a2e35;
  max-width: 100%;
}

@media (min-width: 768px) {
  .version-row {
    grid-template-columns: minmax(0, 1fr) 5rem 6rem auto;
  }
}

.version-row:hover {
  background: #1d2230;
}

.version-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
}

.version-meta {
  margin-top: 0.15rem;
  font-size: 0.78rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-actions {
  display: flex;
  min-width: max-content;
  align-items: center;
  justify-content: flex-end;
}

.download-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.65rem;
  border: 1px solid #2a2e35;
  border-radius: 0.375rem;
  color: #58a6ff;
  text-decoration: none;
  font-size: 0.85rem;
  white-space: nowrap;
}

.download-link:hover {
  background: #1d2230;
  text-decoration: none;
}
</style>