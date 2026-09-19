<template>
  <div class="package-list">
    <div
      v-for="p in packages"
      :key="`${p.Package}-${p.Version}-${p.Architecture}`"
      class="entry-row"
    >
      <router-link :to="`/browse/${encodeURIComponent(p.Package)}`" class="entry-main">
        <span class="entry-text">
          <span class="truncate text-accent">{{ p.Package }}</span>
          <span class="entry-meta md:hidden">
            <span class="font-mono">{{ p.Version }}</span>
            <span class="mx-1.5 text-muted">·</span>{{ p.Architecture }}
            <span class="mx-1.5 text-muted">·</span>{{ formatSize(p.Size) }}
          </span>
        </span>
      </router-link>

      <span class="hidden text-right font-mono text-sm md:block">{{ p.Version }}</span>
      <span class="hidden text-right font-mono text-sm sm:block">{{ p.Architecture }}</span>
      <span class="hidden text-right text-sm sm:block">{{ formatSize(p.Size) }}</span>

      <div class="entry-actions">
        <a :href="`/${p.Filename}`" class="download-link" download>download</a>
      </div>
    </div>
    <p v-if="!packages.length" class="text-muted mt-4 px-1">No packages</p>
  </div>
</template>

<script setup lang="ts">
import type { PackageEntry } from '../types';
import { formatSize } from '../api/packages';

defineProps<{ packages: PackageEntry[] }>();
</script>

<style scoped>
.package-list {
  min-width: 0;
  max-width: 100%;
  margin-top: 1rem;
  border-top: 1px solid #2a2e35;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem 1rem;
  min-height: 3.25rem;
  padding: 0.65rem 0.25rem;
  border-bottom: 1px solid #2a2e35;
  max-width: 100%;
}

@media (min-width: 640px) {
  .entry-row {
    grid-template-columns: minmax(0, 1fr) 5rem 6rem auto;
  }
}

@media (min-width: 768px) {
  .entry-row {
    grid-template-columns: minmax(0, 1fr) 9rem 5rem 6rem auto;
  }
}

.entry-row:hover {
  background: #1d2230;
}

.entry-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
  color: inherit;
  overflow: hidden;
}

.entry-main:hover {
  text-decoration: underline;
}

.entry-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.entry-text .truncate {
  display: block;
}

.entry-meta {
  margin-top: 0.15rem;
  font-size: 0.78rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-actions {
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
