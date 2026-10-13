<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, downloadAttachment } from '../api'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, useWorkspace } from '../composables/workspace'
import { copyToOwnWorkspace } from '../export/rescue'
import { refreshWorkspaces, workspaces } from '../local/context'
import { connection } from '../session'
import { rejectionReason } from '../sharing'
import { requestSync } from '../sync/engine'

/**
 * Changes the server refused (ADR 0014), e.g. made offline while the role was lowered. They stay
 * queued; the user can copy the workspace with them into an own workspace, then drop them here.
 */
const { store, workspaceId, documentsById } = useWorkspace()
const workspace = computed(() => workspaces.value.find((w) => w.id === workspaceId.value))
const online = computed(() => connection.value === 'online')

const issues = useLiveQuery(() => store.operationsWithIssues(), [])
const rejected = computed(() =>
  issues.value.filter(
    (op) => op.issue?.status === 'rejected' && op.workspaceId === workspaceId.value,
  ),
)

const ENTITY_LABELS: Record<string, string> = {
  document: 'Seite',
  block: 'Inhalt',
  tag: 'Tag',
  document_tag: 'Tag an Seite',
  attachment: 'Anhang',
  conflict: 'Konfliktauflösung',
}
const KIND_LABELS: Record<string, string> = {
  create: 'angelegt',
  update: 'geändert',
  move: 'verschoben',
  delete: 'gelöscht',
}

/** The page an operation belongs to, if it is still on this device. */
function pageOf(op: { entity: string; entityId: string; payload: Record<string, unknown> }) {
  const id =
    op.entity === 'document'
      ? op.entityId
      : typeof op.payload.documentId === 'string'
        ? op.payload.documentId
        : null
  return id ? documentsById.value.get(id) : undefined
}

const busy = ref(false)
const error = ref<string | null>(null)
const copied = ref<{ id: string; name: string } | null>(null)

async function copy() {
  busy.value = true
  error.value = null
  try {
    const name = `${workspace.value?.name ?? 'Workspace'} (meine Kopie)`
    const created = await copyToOwnWorkspace(
      store,
      { id: workspaceId.value, name: workspace.value?.name ?? 'Workspace' },
      {
        name,
        send: api.importWorkspace,
        download: downloadAttachment,
        fetchDocument: api.syncDocument,
      },
    )
    copied.value = { id: created.id, name: created.name }
    await refreshWorkspaces(store)
    void requestSync(store)
  } catch (cause) {
    error.value = `Kopieren fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    busy.value = false
  }
}

async function discard() {
  const ok = window.confirm(
    'Die abgelehnten Änderungen in diesem Workspace verwerfen? Hier gilt danach wieder der ' +
      'Stand vom Server. Deine Kopie bleibt erhalten.',
  )
  if (!ok) return
  await store.discardRejected(workspaceId.value)
  if (!workspace.value?.revoked) void requestSync(store, { full: true })
}
</script>

<template>
  <article class="page rejected">
    <h1>Abgelehnte Änderungen</h1>
    <p class="muted">
      Der Server hat diese Änderungen nicht übernommen. Sie bleiben auf diesem Gerät erhalten und
      gehen nicht verloren.
    </p>
    <p v-if="rejected.length === 0" class="muted" data-testid="rejected-empty">
      Keine abgelehnten Änderungen in diesem Workspace.
    </p>

    <template v-else>
      <ul class="rejected-list" aria-label="Abgelehnte Änderungen">
        <li v-for="op in rejected" :key="op.opId" data-testid="rejected-operation">
          <strong
            >{{ ENTITY_LABELS[op.entity] ?? op.entity }}
            {{ KIND_LABELS[op.kind] ?? op.kind }}</strong
          >
          <span v-if="pageOf(op)"> – {{ displayTitle(pageOf(op)) }}</span>
          <small class="muted">{{ rejectionReason(op.issue!.code, op.issue!.message) }}</small>
        </li>
      </ul>

      <h2>Retten</h2>
      <p>
        Lege eine Kopie dieses Workspace mit deinen Änderungen als eigenen Workspace an. Danach
        kannst du die abgelehnten Änderungen hier verwerfen.
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="copied" class="notice" data-testid="rescue-copied">
        Kopie angelegt:
        <RouterLink :to="{ name: 'workspace', params: { workspaceId: copied.id } }">
          {{ copied.name }}
        </RouterLink>
      </p>
      <p class="row">
        <button type="button" :disabled="busy || !online" data-testid="rescue-copy" @click="copy">
          {{ busy ? 'Kopiere…' : 'In eigenen Workspace kopieren' }}
        </button>
        <button
          type="button"
          class="danger"
          :disabled="!copied"
          data-testid="rescue-discard"
          @click="discard"
        >
          Abgelehnte Änderungen verwerfen
        </button>
      </p>
      <p v-if="!online" class="muted">Kopieren braucht eine Verbindung zum Server.</p>
    </template>
  </article>
</template>

<style scoped>
.rejected-list {
  display: grid;
  gap: var(--space-sm);
  padding: 0;
  list-style: none;
}

.rejected-list small {
  display: block;
}
</style>
