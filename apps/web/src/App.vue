<script setup lang="ts">
import { RouterView } from 'vue-router'
import { applyUpdate, updateAvailable } from './pwa'
</script>

<template>
  <p v-if="updateAvailable" class="update-banner" role="status" data-testid="update-banner">
    Eine neue Version ist verfügbar.
    <button type="button" @click="applyUpdate">Neu laden</button>
  </p>
  <RouterView />
</template>

<style scoped>
.update-banner {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 50;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin: 0;
  padding: 0.6rem 0.8rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
}
</style>
