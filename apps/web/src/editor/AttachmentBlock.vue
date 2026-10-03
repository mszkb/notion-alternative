<script setup lang="ts">
import type { Attachment, Block } from '@notion-alt/shared'
import { computed } from 'vue'
import { useAttachmentUrl } from '../composables/attachment-url'
import { useLiveQuery } from '../composables/live-query'
import { useWorkspace } from '../composables/workspace'
import { formatBytes } from '../local/persistence'

const props = defineProps<{ block: Block }>()
const { store } = useWorkspace()

const attachmentId = computed(() => props.block.attrs.attachmentId)
const attachment = useLiveQuery<Attachment | undefined>(
  async () => (attachmentId.value ? store.getAttachment(attachmentId.value) : undefined),
  undefined,
  attachmentId,
)
// Load again when the metadata arrives or changes (e.g. pulled, deleted).
const { url, state } = useAttachmentUrl(
  store,
  attachmentId,
  () => `${attachment.value?.id}:${attachment.value?.deletedAt}`,
)

const name = computed(() => attachment.value?.name ?? props.block.content ?? 'Datei')

/** The server refused the attachment (#64): it stays on this device only. */
const refused = useLiveQuery(
  async () =>
    (await store.operationsWithIssues()).find((op) => op.entityId === attachmentId.value)?.issue,
  undefined,
  attachmentId,
)
const refusedText = computed(() => {
  const code = refused.value?.code
  if (code === 'quota_exceeded') return 'Workspace-Speicher voll – nur auf diesem Gerät gespeichert'
  if (code === 'too_large') return 'Zu groß für den Server – nur auf diesem Gerät gespeichert'
  return refused.value ? `Vom Server abgelehnt – nur auf diesem Gerät gespeichert` : null
})
const placeholder = computed(() => {
  if (state.value === 'deleted' || attachment.value?.deletedAt) return 'Anhang gelöscht'
  if (state.value === 'loading') return 'Wird geladen …'
  return 'Nicht auf diesem Gerät verfügbar – wird bei Verbindung geladen'
})
</script>

<template>
  <figure class="attachment" :data-state="state">
    <p v-if="refusedText" class="error attachment-refused" data-testid="attachment-refused">
      {{ refusedText }}
    </p>
    <template v-if="block.type === 'image'">
      <a v-if="url" :href="url" target="_blank" rel="noopener" :title="name">
        <img :src="url" :alt="block.content || name" />
      </a>
      <p v-else class="attachment-placeholder muted">🖼 {{ name }} · {{ placeholder }}</p>
    </template>
    <template v-else>
      <a v-if="url" class="attachment-file" :href="url" :download="name">
        📎 {{ name }}
        <small v-if="attachment" class="muted">{{ formatBytes(attachment.size) }}</small>
      </a>
      <p v-else class="attachment-placeholder muted">📎 {{ name }} · {{ placeholder }}</p>
    </template>
  </figure>
</template>

<style scoped>
.attachment {
  flex: 1;
  min-width: 0;
  margin: 0.2rem 0;
}

.attachment img {
  display: block;
  max-width: 100%;
  max-height: 32rem;
  border-radius: 6px;
}

.attachment-file {
  display: inline-flex;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.attachment-placeholder {
  margin: 0;
  padding: 0.35rem 0;
}
</style>
