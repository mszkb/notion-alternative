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
  gap: var(--space-md);
  align-items: center;
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-toast);
}
</style>
