<template>
  <form action="/search" method="get" class="w-full">
    <input
      name="q"
      class="w-full px-4 py-3 bg-card border border-border rounded-md text-fg focus:outline-none focus:border-accent"
      :placeholder="placeholder"
      autofocus
    />
  </form>
</template>

<script setup lang="ts">
defineProps<{ placeholder?: string }>();
</script>