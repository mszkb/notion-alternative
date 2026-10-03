<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, downloadAttachment } from '../api'
import { useWorkspace } from '../composables/workspace'
import { buildArchiveExport } from '../export/archive'
import { buildJsonExport } from '../export/json'
import { buildMarkdownExport, saveFile } from '../export/markdown'
import { workspaces } from '../local/context'
import { connection } from '../session'

const { store, workspaceId } = useWorkspace()
const workspace = computed(() => ({
  id: workspaceId.value,
  name: workspaces.value.find((w) => w.id === workspaceId.value)?.name ?? 'Workspace',
}))

const online = computed(() => connection.value === 'online')
const withHistory = ref(true)
const running = ref(false)
const progress = ref<string | null>(null)
const result = ref<string | null>(null)
const missing = ref<string[]>([])
const error = ref<string | null>(null)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Runs one export; history and downloads only while the server is reachable. */
async function run(task: (options: { history: boolean; download: boolean }) => Promise<void>) {
  running.value = true
  result.value = null
  error.value = null
  missing.value = []
  try {
    await task({ history: withHistory.value && online.value, download: online.value })
  } catch (cause) {
    error.value = `Export fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    running.value = false
    progress.value = null
  }
}

const exportArchive = () =>
  run(async ({ history, download }) => {
    const exported = await buildArchiveExport(store, workspace.value, {
      download: download ? downloadAttachment : undefined,
      syncLog: history ? api.syncLog : undefined,
      onProgress: (message) => (progress.value = message),
    })
    saveFile(exported.fileName, exported.blob)
    const { manifest } = exported
    const pages = manifest.files.filter((f) => f.path.endsWith('.md')).length
    result.value =
      `${plural(pages, 'Seite', 'Seiten')} und ` +
      `${plural(manifest.attachments.length, 'Anhang', 'Anhänge')} exportiert` +
      (manifest.history ? ', mit Verlauf.' : ', ohne Verlauf.')
    missing.value = manifest.missing_attachments.map((a) => a.name)
  })

const exportMarkdownZip = () =>
  run(async ({ download }) => {
    const exported = await buildMarkdownExport(store, workspace.value.id, workspace.value.name, {
      download: download ? downloadAttachment : undefined,
    })
    saveFile(exported.fileName, exported.data)
    result.value =
      `${plural(exported.pages, 'Seite', 'Seiten')} exportiert.` +
      (exported.missingAttachments
        ? ` Nicht verfügbare Anhänge (nur als Text enthalten): ${exported.missingAttachments}.`
        : '')
  })

const exportJson = () =>
  run(async ({ history }) => {
    const exported = await buildJsonExport(store, workspace.value, {
      syncLog: history ? api.syncLog : undefined,
    })
    saveFile(exported.fileName, exported.blob)
    result.value =
      `${plural(exported.documents, 'Seite', 'Seiten')} exportiert` +
      (exported.changes === null
        ? ', ohne Verlauf.'
        : `, ${exported.changes} Änderungen im Verlauf.`)
  })
</script>

<template>
  <article class="page export">
    <h1>Export</h1>
    <p class="muted">
      Der Export entsteht aus den Daten auf diesem Gerät und funktioniert auch offline. Online
      werden zusätzlich der Verlauf und fehlende Anhänge vom Server geholt.
    </p>

    <label class="check">
      <input v-model="withHistory" type="checkbox" :disabled="!online" />
      Mit Verlauf (Änderungslog vom Server, für JSON und ZIP)
    </label>
    <p v-if="!online" class="hint muted">
      Offline: Der Verlauf liegt auf dem Server, exportiert wird nur der aktuelle Stand.
    </p>

    <section class="page-section" aria-labelledby="export-archive">
      <h2 id="export-archive">Vollständig (ZIP)</h2>
      <p>
        Empfohlen für Backups: Markdown und JSON zusammen mit allen Anhängen und einer
        <code>manifest.json</code> mit Prüfsummen (SHA-256) aller Dateien.
      </p>
      <button type="button" :disabled="running" @click="exportArchive">
        Vollständigen Export herunterladen
      </button>
    </section>

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
      <button type="button" :disabled="running" @click="exportJson">JSON herunterladen</button>
    </section>

    <p v-if="progress" class="muted" role="status" data-testid="export-progress">
      {{ progress }}
    </p>
    <p v-if="result" class="status" data-testid="export-result">{{ result }}</p>
    <div v-if="missing.length" class="error" data-testid="export-missing">
      <p>
        {{ plural(missing.length, 'Anhang ist', 'Anhänge sind') }} weder auf diesem Gerät noch
        gerade vom Server verfügbar und fehlen im Export (in <code>manifest.json</code> unter
        <code>missing_attachments</code> aufgeführt):
      </p>
      <ul>
        <li v-for="name in missing" :key="name">{{ name }}</li>
      </ul>
    </div>
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
