<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8 gap-3">
      <div class="flex items-baseline gap-3">
        <img
          v-if="siteConfig.iconUrl"
          :src="siteConfig.iconUrl"
          :alt="siteConfig.iconAlt || ''"
          class="h-7 w-7 self-center"
        />
        <h1 class="text-2xl">
          <router-link to="/" class="text-fg no-underline">{{ siteConfig.headerTitle }}</router-link>
        </h1>
      </div>
      <span v-if="siteConfig.headerTagline" class="text-muted text-sm">{{ siteConfig.headerTagline }}</span>
    </header>

    <SearchBox placeholder="搜索包名、描述、依赖…" />

    <section class="mt-8">
      <h2 class="text-lg mb-4">Welcome</h2>
      <p v-for="(line, i) in siteConfig.homepageIntroLines" :key="i" class="text-muted mb-2">
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

    <section v-if="siteConfig.usageSteps.length" class="mt-8">
      <h2 class="text-lg mb-4">How to use this repository</h2>
      <ol class="list-decimal pl-6 space-y-3">
        <li v-for="step in siteConfig.usageSteps" :key="step.title">
          <strong>{{ step.title }}</strong>
          <pre class="mt-1 p-2 bg-card border border-border rounded text-sm overflow-x-auto"><code>{{ step.code }}</code></pre>
          <p v-if="step.note" class="text-muted text-sm mt-1">{{ step.note }}</p>
        </li>
      </ol>
    </section>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { siteConfig } from '../site.config';
import SearchBox from '../components/SearchBox.vue';
import Footer from '../components/Footer.vue';
</script>