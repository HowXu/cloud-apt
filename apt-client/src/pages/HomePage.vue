<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
      <span class="text-muted text-sm">personal apt repository</span>
    </header>

    <SearchBox placeholder="搜索包名、描述、依赖…" />

    <section class="mt-8">
      <h2 class="text-lg mb-4">Welcome</h2>
      <p v-for="(line, i) in siteConfig.introLines" :key="i" class="text-muted mb-2">
        {{ line }}
      </p>
    </section>

    <section class="mt-8">
      <h2 class="text-lg mb-4">Browse</h2>
      <router-link
        :to="`/browse?suite=${siteConfig.defaultSuite}&arch=amd64`"
        class="inline-block px-4 py-2 bg-card border border-border rounded-md text-accent no-underline hover:bg-hover"
      >
        Browse {{ siteConfig.defaultSuite }} (amd64)
      </router-link>
    </section>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { siteConfig } from '../site.config';
import SearchBox from '../components/SearchBox.vue';
import Footer from '../components/Footer.vue';
</script>