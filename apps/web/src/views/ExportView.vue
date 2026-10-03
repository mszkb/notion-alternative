<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, ApiError, downloadAttachment } from '../api'
import { useWorkspace } from '../composables/workspace'
import { buildArchiveExport } from '../export/archive'
import { buildJsonExport } from '../export/json'
import { importWorkspace, readImportFile, type ImportSource } from '../export/import'
import { buildMarkdownExport, saveFile } from '../export/markdown'
import { refreshWorkspaces, workspaces } from '../local/context'
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

// ---------------------------------------------------------------- import

const router = useRouter()
const importSource = ref<ImportSource | null>(null)
const importName = ref('')
const importError = ref<string | null>(null)
const idsExist = ref(false)
const importing = ref(false)
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

const importSummary = computed(() => {
  const source = importSource.value
  if (!source) return null
  const active = source.data.documents.filter((d) => !d.deletedAt).length
  const attachments = source.data.attachments.filter((a) => !a.deletedAt).length
  return {
    pages: active,
    trashed: source.data.documents.length - active,
    attachments,
    contents: source.attachments.size,
    history: source.data.history?.changes.length ?? null,
    exportedAt: dateFormat.format(new Date(source.data.exported_at)),
  }
})

async function chooseImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  importSource.value = null
  importError.value = null
  idsExist.value = false
  if (!file) return
  try {
    importSource.value = await readImportFile(file)
    importName.value = importSource.value.data.workspace.name
  } catch (cause) {
    importError.value = `Datei kann nicht importiert werden: ${cause instanceof Error ? cause.message : String(cause)}`
    input.value = ''
  }
}

async function runImport(newIds: boolean) {
  if (!importSource.value) return
  importing.value = true
  importError.value = null
  try {
    const created = await importWorkspace(store, importSource.value, {
      name: importName.value.trim() || importSource.value.data.workspace.name,
      newIds,
      send: api.importWorkspace,
    })
    await refreshWorkspaces(store)
    await router.push({ name: 'workspace', params: { workspaceId: created.id } })
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'ids_exist') {
      idsExist.value = true
    } else {
      importError.value = `Import fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <article class="page export">
    <h1>Export und Import</h1>
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

    <section class="page-section import" aria-labelledby="import">
      <h2 id="import">Import</h2>
      <p>
        Stellt einen vollständigen Export (ZIP) oder einen JSON-Export als <strong>neuen</strong>
        Workspace her, z. B. in einer frischen Installation. Bestehende Workspaces bleiben
        unverändert. Prüfsummen und Format werden vor dem Import geprüft.
      </p>
      <p v-if="!online" class="hint muted">
        Der Import legt den Workspace auf dem Server an und ist nur online möglich.
      </p>
      <label>
        Exportdatei
        <input
          type="file"
          accept=".zip,.json,application/zip,application/json"
          :disabled="importing"
          data-testid="import-file"
          @change="chooseImportFile"
        />
      </label>

      <div v-if="importSummary" class="import-summary" data-testid="import-summary">
        <p>
          Export vom {{ importSummary.exportedAt }}:
          {{ plural(importSummary.pages, 'Seite', 'Seiten')
          }}<template v-if="importSummary.trashed"
            >, {{ importSummary.trashed }} im Papierkorb</template
          >, {{ plural(importSummary.attachments, 'Anhang', 'Anhänge') }}
          <template v-if="importSummary.contents < importSummary.attachments">
            (davon {{ importSummary.contents }} mit Inhalt)
          </template>
          ·
          {{
            importSummary.history === null
              ? 'ohne Verlauf'
              : `${importSummary.history} Änderungen im Verlauf`
          }}
        </p>
        <label>
          Name des neuen Workspaces
          <input v-model="importName" maxlength="100" />
        </label>
        <button
          v-if="!idsExist"
          type="button"
          :disabled="importing || !online"
          @click="runImport(false)"
        >
          Als neuen Workspace importieren
        </button>
        <div v-else class="error" data-testid="import-ids-exist">
          <p>
            Diese Daten gibt es auf dem Server schon (z. B. wurde derselbe Export bereits
            importiert). Es wurde nichts verändert. Als Kopie importieren? Seiten, Links und Anhänge
            bekommen dabei neue IDs.
          </p>
          <button type="button" :disabled="importing || !online" @click="runImport(true)">
            Als Kopie importieren
          </button>
        </div>
      </div>
      <p v-if="importing" class="muted" role="status">Importiere…</p>
      <p v-if="importError" class="error" data-testid="import-error">{{ importError }}</p>
    </section>
  </article>
</template>

<style scoped>
.check {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}
.import-summary {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
</style>
