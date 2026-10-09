<script setup lang="ts">
import { type Conflict, inlineToPlainText } from '@notion-alt/shared'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLiveQuery } from '../composables/live-query'
import { useWorkspace } from '../composables/workspace'

const { store, workspaceId, readOnly } = useWorkspace()
const router = useRouter()

const conflicts = useLiveQuery(() => store.openConflicts(workspaceId.value), [], workspaceId)
const titles = ref(new Map<string, string>())
watch(
  conflicts,
  async (list) => {
    const next = new Map<string, string>()
    for (const conflict of list) {
      if (conflict.documentId) {
        next.set(
          conflict.documentId,
          (await store.documentTitle(conflict.documentId)) || 'Unbenannt',
        )
      }
    }
    titles.value = next
  },
  { immediate: true },
)

const merging = ref<string | null>(null)
const mergeText = ref('')
const error = ref<string | null>(null)

const REASONS: Record<Conflict['reason'], string> = {
  changed: 'Gleichzeitig auf einem anderen Gerät geändert.',
  deleted: 'Auf einem anderen Gerät gelöscht.',
  parent_deleted: 'Die Seite wurde auf einem anderen Gerät gelöscht.',
}

const ENTITIES: Record<Conflict['entity'], string> = {
  document: 'Seite',
  block: 'Block',
  tag: 'Tag',
  document_tag: 'Tag-Zuordnung',
  attachment: 'Anhang',
}

const isMine = (conflict: Conflict) => store.isOwnDevice(conflict.local.deviceId)
const isDeletion = (conflict: Conflict) => conflict.reason !== 'changed'

/** Readable text of one side: block text, page title or a description of the change. */
function describe(conflict: Conflict, kind: string, data: Record<string, unknown> | null): string {
  if (kind === 'delete' || data?.deletedAt) return '(gelöscht)'
  if (!data) return '(nicht vorhanden)'
  if (typeof data.content === 'string') {
    return data.type === 'code' ? data.content : inlineToPlainText(data.content) || '(leer)'
  }
  if (typeof data.title === 'string') return data.title || 'Unbenannt'
  if (typeof data.name === 'string') return data.name
  if (kind === 'move' || 'sortKey' in data) return '(verschoben)'
  if ('favorite' in data) return data.favorite ? '(als Favorit markiert)' : '(kein Favorit)'
  return `(${ENTITIES[conflict.entity]} geändert)`
}

function localText(conflict: Conflict): string {
  return describe(conflict, conflict.local.kind, conflict.local.payload)
}

function remoteText(conflict: Conflict): string {
  return describe(conflict, 'update', conflict.remote)
}

/** Manual merge exists for text: block content and page titles. */
function canMerge(conflict: Conflict): boolean {
  if (isDeletion(conflict) || conflict.local.kind !== 'update') return false
  const payload = conflict.local.payload
  return (
    (conflict.entity === 'block' && typeof payload.content === 'string') ||
    (conflict.entity === 'document' && typeof payload.title === 'string')
  )
}

function startMerge(conflict: Conflict) {
  merging.value = conflict.id
  const remote = conflict.remote ?? {}
  mergeText.value = String(
    conflict.entity === 'block' ? (remote.content ?? '') : (remote.title ?? ''),
  )
}

async function resolve(conflict: Conflict, resolution: 'local' | 'remote' | 'manual') {
  error.value = null
  try {
    const restored = await store.resolveConflict(
      conflict.id,
      resolution,
      resolution === 'manual' ? mergeText.value : undefined,
    )
    merging.value = null
    if (restored) {
      await router.push({
        name: 'page',
        params: { workspaceId: workspaceId.value, documentId: restored },
      })
    }
  } catch (e) {
    console.error(e)
    error.value = 'Der Konflikt konnte nicht aufgelöst werden.'
  }
}
</script>

<template>
  <article class="page conflicts">
    <h1>Konflikte</h1>
    <p class="muted">
      Hier landen Änderungen, die auf zwei Geräten gleichzeitig an derselben Stelle gemacht wurden.
      Beide Stände bleiben erhalten, bis du dich entscheidest; die Auflösung funktioniert auch
      offline und wird danach synchronisiert.
    </p>
    <p v-if="conflicts.length === 0" class="muted" data-testid="no-conflicts">
      Keine offenen Konflikte.
    </p>
    <section
      v-for="conflict in conflicts"
      :key="conflict.id"
      class="conflict"
      :aria-label="`Konflikt: ${titles.get(conflict.documentId ?? '') ?? ENTITIES[conflict.entity]}`"
    >
      <header>
        <h2>
          <RouterLink
            v-if="conflict.documentId && !isDeletion(conflict)"
            :to="{ name: 'page', params: { workspaceId, documentId: conflict.documentId } }"
          >
            {{ titles.get(conflict.documentId) ?? 'Seite' }}
          </RouterLink>
          <span v-else>{{
            titles.get(conflict.documentId ?? '') ?? ENTITIES[conflict.entity]
          }}</span>
          <small class="muted"> · {{ ENTITIES[conflict.entity] }}</small>
        </h2>
        <p class="muted">{{ REASONS[conflict.reason] }}</p>
      </header>
      <div class="versions">
        <figure>
          <figcaption>
            {{
              isMine(conflict) ? 'Deine Änderung (dieses Gerät)' : 'Änderung eines anderen Geräts'
            }}
          </figcaption>
          <blockquote data-testid="local-version">{{ localText(conflict) }}</blockquote>
        </figure>
        <figure>
          <figcaption>Stand auf dem Server</figcaption>
          <blockquote data-testid="remote-version">{{ remoteText(conflict) }}</blockquote>
        </figure>
      </div>
      <form v-if="merging === conflict.id" @submit.prevent="resolve(conflict, 'manual')">
        <label>
          Zusammengeführte Fassung
          <textarea v-model="mergeText" rows="4"></textarea>
        </label>
        <div class="row">
          <button type="button" class="link" @click="merging = null">Abbrechen</button>
          <button type="submit">Zusammengeführt speichern</button>
        </div>
      </form>
      <p v-else-if="readOnly" class="muted">Auflösen können Mitglieder, die bearbeiten dürfen.</p>
      <div v-else class="actions">
        <button type="button" @click="resolve(conflict, 'local')">
          {{
            isDeletion(conflict)
              ? 'Als neue Seite wiederherstellen'
              : isMine(conflict)
                ? 'Meine Änderung übernehmen'
                : 'Diese Änderung übernehmen'
          }}
        </button>
        <button type="button" @click="resolve(conflict, 'remote')">
          {{ isDeletion(conflict) ? 'Löschung übernehmen' : 'Server-Stand behalten' }}
        </button>
        <button v-if="canMerge(conflict)" type="button" class="link" @click="startMerge(conflict)">
          Manuell zusammenführen
        </button>
      </div>
    </section>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.conflict {
  display: grid;
  gap: var(--space-md);
  margin: var(--space-xl) 0;
  padding: var(--space-lg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.conflict h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.conflict header p {
  margin: var(--space-xs) 0 0;
}

.versions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-md);
}

figure {
  margin: 0;
}

figcaption {
  font-size: var(--text-sm);
  font-weight: 600;
}

blockquote {
  margin: var(--space-xs) 0 0;
  padding: var(--space-sm) var(--space-md);
  white-space: pre-wrap;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-radius: var(--radius);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  align-items: center;
}

textarea {
  padding: var(--space-sm) var(--space-md);
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
</style>
