<script setup lang="ts">
import type { DocumentVersion, DocumentVersionState } from '@notion-alt/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, useWorkspace } from '../composables/workspace'
import { diffBlocks } from '../editor/version-diff'
import { connection } from '../session'

const { store, workspaceId, documentsById } = useWorkspace()
const route = useRoute()
const documentId = String(route.params.documentId)
const page = computed(() => documentsById.value.get(documentId))
const current = useLiveQuery(() => store.listBlocks(documentId), [])

const versions = ref<DocumentVersion[] | null>(null)
const selected = ref<DocumentVersionState | null>(null)
const deviceNames = ref(new Map<string, string>())
const error = ref<string | null>(null)

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

onMounted(async () => {
  if (connection.value !== 'online') return
  try {
    versions.value = (await api.documentHistory(documentId, workspaceId.value)).versions
    const devices = (await api.listDevices()).devices
    deviceNames.value = new Map(devices.map((d) => [d.id, d.name]))
    if (versions.value[0]) await select(versions.value[0])
  } catch {
    error.value = 'Der Verlauf konnte nicht geladen werden.'
  }
})

function deviceName(id: string): string {
  if (id === store.deviceId) return 'dieses Gerät'
  return deviceNames.value.get(id) ?? 'entferntes Gerät'
}

async function select(version: DocumentVersion) {
  error.value = null
  try {
    selected.value = await api.documentVersion(documentId, version.seq, workspaceId.value)
  } catch {
    error.value = 'Diese Version konnte nicht geladen werden.'
  }
}

const diff = computed(() =>
  selected.value ? diffBlocks(selected.value.blocks, current.value) : [],
)
const changedCount = computed(() => diff.value.filter((d) => d.status !== 'same').length)
const titleChanged = computed(
  () => selected.value && page.value && selected.value.document.title !== page.value.title,
)
</script>

<template>
  <article class="page history">
    <header class="page-header">
      <nav class="breadcrumbs" aria-label="Pfad">
        <RouterLink :to="{ name: 'page', params: { workspaceId, documentId } }">
          {{ page ? displayTitle(page) : 'Seite' }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span>Verlauf</span>
      </nav>
    </header>
    <h1>Verlauf</h1>
    <p v-if="connection !== 'online'" class="muted" data-testid="history-offline">
      Der Verlauf ist nur mit Serververbindung verfügbar; die Seite selbst bleibt offline nutzbar.
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="versions" class="history-layout">
      <ol class="versions" aria-label="Versionen">
        <li v-for="version in versions" :key="version.seq">
          <button
            type="button"
            class="version"
            :aria-current="selected?.seq === version.seq || undefined"
            @click="select(version)"
          >
            <strong>{{ dateFormat.format(new Date(version.at)) }}</strong>
            <small class="muted">
              {{ deviceName(version.deviceId) }} · {{ version.changes }} Änderung{{
                version.changes === 1 ? '' : 'en'
              }}
            </small>
          </button>
        </li>
      </ol>
      <section v-if="selected" class="version-detail" aria-label="Ausgewählte Version">
        <h2>{{ selected.document.title || 'Unbenannt' }}</h2>
        <p class="muted" data-testid="version-summary">
          {{
            changedCount === 0 && !titleChanged
              ? 'Entspricht dem aktuellen Stand.'
              : `Unterschiede zum aktuellen Stand: ${changedCount} Block${changedCount === 1 ? '' : 'e'}${titleChanged ? ', Titel' : ''}.`
          }}
        </p>
        <ul class="diff">
          <li
            v-for="entry in diff"
            :key="entry.id"
            :class="`diff-${entry.status}`"
            :data-status="entry.status"
          >
            <template v-if="entry.status === 'changed'">
              <del>{{ entry.before }}</del>
              <ins>{{ entry.after }}</ins>
            </template>
            <del v-else-if="entry.status === 'removed'">{{ entry.before }}</del>
            <ins v-else-if="entry.status === 'added'">{{ entry.after }}</ins>
            <span v-else>{{ entry.before }}</span>
          </li>
        </ul>
      </section>
    </div>
  </article>
</template>

<style scoped>
.history-layout {
  display: grid;
  grid-template-columns: minmax(12rem, 16rem) 1fr;
  gap: 1.5rem;
}

@media (max-width: 720px) {
  .history-layout {
    grid-template-columns: 1fr;
  }
}

.versions {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.version {
  display: grid;
  width: 100%;
  padding: 0.45rem 0.6rem;
  color: inherit;
  text-align: left;
  background: none;
  border-radius: 6px;
}

.version[aria-current] {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.diff {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
  white-space: pre-wrap;
}

.diff del {
  color: var(--error);
}

.diff ins {
  display: block;
  color: inherit;
  text-decoration: none;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.diff-changed del {
  display: block;
}
</style>
