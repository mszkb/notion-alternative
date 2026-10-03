<script setup lang="ts">
import { computed, ref } from 'vue'
import { downloadAttachment } from '../api'
import { useWorkspace } from '../composables/workspace'
import { buildMarkdownExport, saveFile } from '../export/markdown'
import { workspaces } from '../local/context'
import { connection } from '../session'

const { store, workspaceId } = useWorkspace()
const workspaceName = computed(
  () => workspaces.value.find((w) => w.id === workspaceId.value)?.name ?? 'Workspace',
)

const running = ref(false)
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

    <p v-if="result" class="status" data-testid="export-result">{{ result }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </article>
</template>
