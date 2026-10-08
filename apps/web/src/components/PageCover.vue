<script setup lang="ts">
import type { Document } from '@notion-alt/shared'
import { computed } from 'vue'
import { useAttachmentUrl } from '../composables/attachment-url'
import { useWorkspace } from '../composables/workspace'

/** Cover of a page (#136): a built-in gradient or an image attached to the page. */
const props = defineProps<{ cover: NonNullable<Document['cover']> }>()
const { store } = useWorkspace()

const gradient = computed(() =>
  props.cover.startsWith('gradient:') ? props.cover.slice('gradient:'.length) : null,
)
const attachmentId = computed(() =>
  props.cover.startsWith('attachment:') ? props.cover.slice('attachment:'.length) : undefined,
)
const { url } = useAttachmentUrl(store, attachmentId)
</script>

<template>
  <div
    class="page-cover"
    :class="gradient ? `cover-${gradient}` : 'cover-image'"
    data-testid="page-cover"
  >
    <img v-if="attachmentId && url" :src="url" alt="" />
  </div>
</template>
