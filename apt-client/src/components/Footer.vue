<template>
  <footer class="mt-12 pt-4 border-t border-border text-muted text-sm flex items-center justify-end">
    <a
      v-if="siteConfig.showGithubButton"
      :href="siteConfig.githubUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="text-accent no-underline hover:underline"
    >
      GitHub
    </a>
  </footer>
</template>

<script setup lang="ts">
import { siteConfig } from '../site.config';
</script>
