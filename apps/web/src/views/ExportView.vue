<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, ApiError, downloadAttachment } from '../api'
import { useWorkspace } from '../composables/workspace'
import { buildArchiveExport } from '../export/archive'
import { buildJsonExport } from '../export/json'
import {
  importWorkspace,
  readImportFile,
  readNotionImportFile,
  type ImportSource,
} from '../export/import'
import type { NotionImportReport } from '@notion-alt/shared'
import { buildMarkdownExport, saveFile } from '../export/markdown'
import { refreshWorkspaces, workspaces } from '../local/context'
import { connection } from '../session'
import { requestSync } from '../sync/engine'
import { formatDateTime } from '../format'

const { store, workspaceId } = useWorkspace()
const workspace = computed(() => ({
  id: workspaceId.value,
  name: workspaces.value.find((w) => w.id === workspaceId.value)?.name ?? 'Workspace',
}))

const online = computed(() => connection.value === 'online')
/** Without an account there is no server: no history, no import (ADR 0023). */
const withAccount = computed(() => connection.value !== 'local')
const withHistory = ref(true)
const running = ref(false)
const progress = ref<string | null>(null)
const result = ref<string | null>(null)
const missing = ref<string[]>([])
/** Pages exported without content because it is not on this device (ADR 0017). */
const missingPages = ref<string[]>([])
const error = ref<string | null>(null)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Runs one export; history and downloads only while the server is reachable. */
async function run(task: (options: { history: boolean; download: boolean }) => Promise<void>) {
  running.value = true
  result.value = null
  error.value = null
  missing.value = []
  missingPages.value = []
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
      fetchDocument: download ? api.syncDocument : undefined,
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
    missingPages.value = (manifest.missing_documents ?? []).map((d) => d.title || 'Unbenannt')
  })

const exportMarkdownZip = () =>
  run(async ({ download }) => {
    const exported = await buildMarkdownExport(store, workspace.value.id, workspace.value.name, {
      download: download ? downloadAttachment : undefined,
      fetchDocument: download ? api.syncDocument : undefined,
    })
    saveFile(exported.fileName, exported.data)
    missingPages.value = exported.missingDocuments.map((d) => d.title || 'Unbenannt')
    result.value =
      `${plural(exported.pages, 'Seite', 'Seiten')} exportiert.` +
      (exported.missingAttachments
        ? ` Nicht verfügbare Anhänge (nur als Text enthalten): ${exported.missingAttachments}.`
        : '')
  })

const exportJson = () =>
  run(async ({ history, download }) => {
    const exported = await buildJsonExport(store, workspace.value, {
      syncLog: history ? api.syncLog : undefined,
      fetchDocument: download ? api.syncDocument : undefined,
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
/** Set when the source is a converted Notion export (#137). */
const notionReport = ref<NotionImportReport | null>(null)

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
    exportedAt: formatDateTime(source.data.exported_at),
  }
})

async function chooseNotionFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  importSource.value = null
  notionReport.value = null
  importError.value = null
  idsExist.value = false
  if (!file) return
  try {
    const source = await readNotionImportFile(file, 'Aus Notion')
    notionReport.value = source.report
    importSource.value = source
    importName.value = 'Aus Notion'
  } catch (cause) {
    importError.value = `Datei kann nicht importiert werden: ${cause instanceof Error ? cause.message : String(cause)}`
    input.value = ''
  }
}

async function chooseImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  importSource.value = null
  notionReport.value = null
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
    // Fetch the new workspace now instead of at the next sync trigger.
    void requestSync(store)
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

    <section class="export-main" aria-labelledby="export-all">
      <h2 id="export-all">Sicherung</h2>
      <p>
        Alle Seiten, Bilder und Dateien als Sicherung in einer ZIP-Datei. Damit lässt sich alles
        wiederherstellen oder in andere Programme mitnehmen. Funktioniert auch ohne Internet.
      </p>
      <button type="button" :disabled="running" @click="exportArchive">Alles exportieren</button>
      <label v-if="withAccount" class="check">
        <input v-model="withHistory" type="checkbox" :disabled="!online" />
        Mit Verlauf (frühere Versionen der Seiten)
      </label>
      <p v-if="!withAccount" class="hint muted" data-testid="export-history-hint">
        Ohne Konto gibt es keinen Verlauf auf einem Server; exportiert wird der aktuelle Stand.
      </p>
      <p v-else-if="!online" class="hint muted" data-testid="export-history-hint">
        Gerade keine Verbindung zum Server: Frühere Versionen liegen dort, exportiert wird der
        aktuelle Stand.
      </p>
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
    <div v-if="missingPages.length" class="error" data-testid="export-missing-pages">
      <p>
        Der Inhalt von {{ plural(missingPages.length, 'Seite', 'Seiten') }} ist nicht auf diesem
        Gerät und konnte ohne Serververbindung nicht geladen werden. Exportiert sind nur Titel und
        Metadaten (im ZIP in <code>manifest.json</code> unter <code>missing_documents</code>):
      </p>
      <ul>
        <li v-for="(title, i) in missingPages" :key="i">{{ title }}</li>
      </ul>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <details class="page-section more-formats" data-testid="more-formats">
      <summary>Weitere Formate</summary>
      <section aria-labelledby="export-markdown">
        <h3 id="export-markdown">Markdown</h3>
        <p>
          Eine Textdatei pro Seite, Ordner wie im Seitenbaum. Gut lesbar und in vielen Programmen zu
          öffnen; nur der aktuelle Stand.
        </p>
        <button type="button" class="secondary" :disabled="running" @click="exportMarkdownZip">
          Markdown herunterladen (ZIP)
        </button>
      </section>
      <section aria-labelledby="export-json">
        <h3 id="export-json">JSON</h3>
        <p>Eine einzelne Datei mit allen Daten, z. B. zum Wiederherstellen ohne Anhänge.</p>
        <button type="button" class="secondary" :disabled="running" @click="exportJson">
          JSON herunterladen
        </button>
      </section>
      <details class="tech-details">
        <summary>Technische Details</summary>
        <ul>
          <li>
            <strong>Alles exportieren:</strong> Markdown und JSON zusammen mit allen Anhängen und
            einer <code>manifest.json</code> mit Prüfsummen (SHA-256) aller Dateien.
          </li>
          <li>
            <strong>Markdown:</strong> eine <code>.md</code>-Datei pro Seite; Seitenlinks werden zu
            relativen Pfaden, Anhänge liegen in <code>_attachments/</code>. Tags, Favorit und
            Zeitstempel stehen im Front Matter.
          </li>
          <li>
            <strong>JSON:</strong> verlustfreie Kopie mit IDs aller Seiten, Blöcke, Tags, Links und
            Anhang-Metadaten, auch Seiten im Papierkorb; Format <code>schema_version</code> 3.
          </li>
          <li>Der Verlauf ist das Änderungslog vom Server (in ZIP und JSON).</li>
        </ul>
      </details>
    </details>

    <section class="page-section import" aria-labelledby="import">
      <h2 id="import">Import</h2>
      <p v-if="!withAccount" class="hint muted" data-testid="import-account-hint">
        Ein Import legt einen neuen Workspace auf dem Server an und braucht daher ein Konto.
        <RouterLink :to="{ name: 'login' }">Anmelden</RouterLink>
      </p>
      <p v-else-if="!online" class="hint muted">
        Der Import legt den Workspace auf dem Server an und ist nur online möglich.
      </p>

      <h3 id="import-backup">Sicherung wiederherstellen</h3>
      <p class="muted">
        Eine Sicherung aus dieser App (ZIP oder JSON) als <strong>neuen</strong> Workspace anlegen,
        z. B. auf einem neuen Server. Bestehende Workspaces bleiben unverändert; die Datei wird
        vorher auf Vollständigkeit geprüft.
      </p>
      <label>
        Sicherungsdatei
        <input
          type="file"
          accept=".zip,.json,application/zip,application/json"
          :disabled="importing"
          data-testid="import-file"
          @change="chooseImportFile"
        />
      </label>

      <h3 id="import-notion">Aus Notion importieren</h3>
      <p class="muted">
        In Notion unter <strong>Einstellungen → Export → „Markdown &amp; CSV“</strong> (mit
        Unterseiten und Dateien) exportieren und die ZIP-Datei hier wählen. Seiten, Unterseiten,
        Bilder, Dateien, Links, To-dos, Toggles und Hinweise werden übernommen; was es hier nicht
        gibt, wird vereinfacht und vor dem Import aufgelistet.
      </p>
      <label>
        Notion-Export (ZIP)
        <input
          type="file"
          accept=".zip,application/zip"
          :disabled="importing"
          data-testid="import-notion-file"
          @change="chooseNotionFile"
        />
      </label>

      <div v-if="notionReport" class="import-summary" data-testid="notion-report">
        <p>
          {{ plural(notionReport.pages, 'Seite', 'Seiten') }},
          {{ plural(notionReport.blocks, 'Block', 'Blöcke') }},
          {{ plural(notionReport.attachments, 'Anhang', 'Anhänge')
          }}<template v-if="notionReport.databases"
            >, {{ plural(notionReport.databases, 'Datenbank', 'Datenbanken') }}</template
          >.
        </p>
        <template v-if="Object.keys(notionReport.simplified).length">
          <p>Vereinfacht:</p>
          <ul>
            <li v-for="(count, what) in notionReport.simplified" :key="what">
              {{ what }} ({{ count }}×)
            </li>
          </ul>
        </template>
      </div>

      <div v-if="importSummary" class="import-summary" data-testid="import-summary">
        <p v-if="!notionReport">
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
  gap: var(--space-sm);
  align-items: flex-start;
  margin-bottom: var(--space-md);
}
.export-main {
  display: grid;
  gap: var(--space-md);
  justify-items: start;
}

.export-main h2,
.export-main p,
.export-main .check {
  margin: 0;
}

.more-formats section {
  margin-top: var(--space-lg);
}

.more-formats h3 {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-sm);
}

.more-formats p {
  margin: 0 0 var(--space-sm);
}

.more-formats summary,
.tech-details summary {
  cursor: pointer;
  font-weight: 600;
}

.tech-details {
  margin-top: var(--space-lg);
  font-size: var(--text-sm);
}

.import h3 {
  margin: var(--space-xl) 0 var(--space-xs);
  font-size: var(--text-sm);
}

.import-summary {
  display: grid;
  gap: var(--space-md);
  margin-top: var(--space-md);
}
</style>
