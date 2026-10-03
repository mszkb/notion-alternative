<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, downloadAttachment } from '../api'
import { useWorkspace } from '../composables/workspace'
import { buildJsonExport } from '../export/json'
import { buildMarkdownExport, saveFile } from '../export/markdown'
import { workspaces } from '../local/context'
import { connection } from '../session'

const { store, workspaceId } = useWorkspace()
const workspaceName = computed(
  () => workspaces.value.find((w) => w.id === workspaceId.value)?.name ?? 'Workspace',
)

const running = ref(false)
const withHistory = ref(true)
const online = computed(() => connection.value === 'online')
const result = ref<string | null>(null)
const error = ref<string | null>(null)

async function exportMarkdownZip() {
  running.value = true
  result.value = null
  error.value = null
  try {
    const exported = await buildMarkdownExport(store, workspaceId.value, workspaceName.value, {
      download: connection.value === 'online' ? downloadAttachment : undefined,
    })
    saveFile(exported.fileName, exported.data)
    result.value =
      `${exported.pages} Seite${exported.pages === 1 ? '' : 'n'} exportiert.` +
      (exported.missingAttachments
        ? ` ${exported.missingAttachments} Anhang/Anhänge fehlen auf diesem Gerät und sind nur als Text enthalten.`
        : '')
  } catch (cause) {
    error.value = `Export fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    running.value = false
  }
}

async function exportJson() {
  running.value = true
  result.value = null
  error.value = null
  try {
    const history = withHistory.value && online.value
    const exported = await buildJsonExport(
      store,
      { id: workspaceId.value, name: workspaceName.value },
      { syncLog: history ? api.syncLog : undefined },
    )
    saveFile(exported.fileName, exported.blob)
    result.value =
      `${exported.documents} Seite${exported.documents === 1 ? '' : 'n'} exportiert` +
      (exported.changes === null
        ? ', ohne Verlauf.'
        : `, ${exported.changes} Änderungen im Verlauf.`)
  } catch (cause) {
    error.value = `Export fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    running.value = false
  }
}
</script>

<template>
  <article class="page export">
    <h1>Export</h1>
    <p class="muted">
      Der Export entsteht aus den Daten auf diesem Gerät und funktioniert auch offline.
    </p>

    <section class="page-section" aria-labelledby="export-markdown">
      <h2 id="export-markdown">Markdown</h2>
      <p>
        Eine <code>.md</code>-Datei pro Seite, Ordner entsprechen dem Seitenbaum. Seitenlinks werden
        zu relativen Pfaden, Anhänge liegen in <code>_attachments/</code>. Tags, Favorit und
        Zeitstempel stehen im Front Matter. Nur der aktuelle Stand, ohne Verlauf.
      </p>
      <button type="button" :disabled="running" @click="exportMarkdownZip">
        Markdown herunterladen (ZIP)
      </button>
    </section>

    <section class="page-section" aria-labelledby="export-json">
      <h2 id="export-json">JSON</h2>
      <p>
        Verlustfreie Kopie für Backup und Import: alle Seiten, Blöcke, Tags, Links und
        Anhang-Metadaten mit ihren IDs, auch Seiten im Papierkorb. Format:
        <code>schema_version</code> 1.
      </p>
      <label class="check">
        <input v-model="withHistory" type="checkbox" :disabled="!online" />
        Mit Verlauf (Änderungslog vom Server)
      </label>
      <p v-if="!online" class="hint muted">
        Offline: Der Verlauf liegt auf dem Server, exportiert wird nur der aktuelle Stand.
      </p>
      <button type="button" :disabled="running" @click="exportJson">JSON herunterladen</button>
    </section>

    <p v-if="result" class="status" data-testid="export-result">{{ result }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </article>
</template>

<style scoped>
.check {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}
</style>
