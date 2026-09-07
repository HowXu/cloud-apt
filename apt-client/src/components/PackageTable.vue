<template>
  <table class="w-full border-collapse mt-4">
    <thead>
      <tr class="text-muted text-sm">
        <th class="text-left px-3 py-2 border-b border-border">Package</th>
        <th class="text-left px-3 py-2 border-b border-border">Version</th>
        <th class="text-left px-3 py-2 border-b border-border">Arch</th>
        <th class="text-left px-3 py-2 border-b border-border">Size</th>
        <th class="text-left px-3 py-2 border-b border-border"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in packages" :key="`${p.Package}-${p.Version}-${p.Architecture}`" class="hover:bg-hover">
        <td class="px-3 py-2">
          <router-link :to="`/browse/${encodeURIComponent(p.Package)}`" class="text-accent no-underline hover:underline">
            {{ p.Package }}
          </router-link>
        </td>
        <td class="px-3 py-2 font-mono text-sm">{{ p.Version }}</td>
        <td class="px-3 py-2 font-mono text-sm">{{ p.Architecture }}</td>
        <td class="px-3 py-2">{{ formatSize(p.Size) }}</td>
        <td class="px-3 py-2">
          <a :href="`/${p.Filename}`" class="text-accent no-underline hover:underline" download>Download .deb</a>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-if="!packages.length" class="text-muted mt-4">No packages</p>
</template>

<script setup lang="ts">
import type { PackageEntry } from '../types';
import { formatSize } from '../api/packages';

defineProps<{ packages: PackageEntry[] }>();
</script>