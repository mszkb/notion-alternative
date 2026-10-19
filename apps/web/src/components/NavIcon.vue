<script setup lang="ts">
/** Small line icons for the sidebar entries (own drawings, ux-guide.md: no third-party marks). */
defineProps<{ name: 'settings' | 'members' | 'trash' | 'export' | 'keyboard' | 'page' }>()
</script>

<template>
  <svg
    class="nav-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'settings'">
      <circle cx="8" cy="8" r="2.2" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
      />
    </template>
    <template v-else-if="name === 'members'">
      <circle cx="6" cy="5.5" r="2.3" />
      <path d="M1.8 13.5c.5-2.4 2.2-3.7 4.2-3.7s3.7 1.3 4.2 3.7" />
      <path d="M10.5 3.4a2.2 2.2 0 0 1 0 4.2M12 9.9c1.2.5 2 1.7 2.3 3.6" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M2.5 4h11M6 4V2.5h4V4M3.8 4l.7 9.5h7l.7-9.5M6.6 6.5v4.5M9.4 6.5v4.5" />
    </template>
    <template v-else-if="name === 'export'">
      <path d="M8 1.8v8M5 4.8l3-3 3 3M2.5 9.5v4h11v-4" />
    </template>
    <template v-else-if="name === 'keyboard'">
      <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" />
      <path d="M4 7h.01M6.7 7h.01M9.3 7h.01M12 7h.01M5 10h6" />
    </template>
    <template v-else>
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3" />
    </template>
  </svg>
</template>
