<script setup lang="ts">
import { DOCUMENT_TITLE_MAX_LENGTH, type Document } from '@notion-alt/shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TagBar from '../components/TagBar.vue'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, NO_CHILDREN, useWorkspace } from '../composables/workspace'
import PageEditor from '../editor/PageEditor.vue'
import { registerPendingEdits } from '../pending-edits'
import { connection } from '../session'
import { ensureDocumentLoaded, type OpenOutcome } from '../sync/offline'

const { store, workspaceId, documentsById, childrenByParent } = useWorkspace()
const route = useRoute()
const router = useRouter()

// Fixed for this instance (the router view is keyed by page). Never derive it from the live
// route: during unmount the route already points to the next page, and saving the title on
// unmount would otherwise rename that page.
const documentId = String(route.params.documentId)
// Read directly (not only from the workspace list) to tell "loading" from "not found".
const loaded = useLiveQuery<Document | null | undefined>(
  async () => (await store.getDocument(documentId)) ?? null,
  undefined,
)
const document = computed(() => documentsById.value.get(documentId) ?? loaded.value)

const ancestors = computed(() => {
  const chain: Document[] = []
  let parentId = document.value?.parentId ?? null
  while (parentId) {
    const parent = documentsById.value.get(parentId)
    if (!parent) break
    chain.unshift(parent)
    parentId = parent.parentId
  }
  return chain
})
const children = computed(() => childrenByParent.value.get(documentId) ?? NO_CHILDREN)

// ---------------------------------------------------------------- content on demand (ADR 0017)

/** Whether the page's content is on this device; `loading` while it is fetched. */
const content = ref<OpenOutcome | 'loading' | 'error'>('loading')
let loading = false

async function loadContent() {
  if (loading) return
  loading = true
  try {
    content.value = await ensureDocumentLoaded(store, workspaceId.value, documentId)
  } catch {
    content.value = 'error'
  } finally {
    loading = false
  }
}
void loadContent()
// Try again as soon as the server is reachable.
watch(connection, (state) => {
  if (state === 'online' && content.value !== 'loaded') void loadContent()
})
const backlinks = useLiveQuery(() => store.backlinks(documentId), [])
/** Backlinks come from pages whose content is on this device (ADR 0017). */
const unloadedCount = useLiveQuery(
  async () => (await store.unloadedDocuments(workspaceId.value)).length,
  0,
)
const conflicts = useLiveQuery(
  async () =>
    (await store.openConflicts(workspaceId.value)).filter((c) => c.documentId === documentId),
  [],
)

// ---------------------------------------------------------------- title

const title = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
let titleTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => document.value?.title,
  (value) => {
    // Do not overwrite what the user is typing with an older saved value.
    if (value !== undefined && window.document.activeElement !== titleInput.value && !titleTimer) {
      title.value = value
    }
  },
  { immediate: true },
)

function saveTitle(): Promise<void> {
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = null
  if (document.value && title.value !== document.value.title) {
    return store.renameDocument(documentId, title.value)
  }
  return Promise.resolve()
}
const stopPendingTitle = registerPendingEdits(saveTitle)

function onTitleInput() {
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(saveTitle, 400)
}

function focusFirstBlock() {
  saveTitle()
  const first = window.document.querySelector<HTMLElement>('.editor .block-input')
  first?.focus()
}

onBeforeUnmount(() => {
  void saveTitle()
  stopPendingTitle()
})

// ---------------------------------------------------------------- header (#132)

const editedFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const edited = computed(() =>
  document.value ? editedFormat.format(new Date(document.value.updatedAt)) : '',
)

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)

function closeMenuOutside(event: PointerEvent) {
  if (menuRoot.value && !menuRoot.value.contains(event.target as Node)) menuOpen.value = false
}
watch(menuOpen, (open) => {
  if (open) window.addEventListener('pointerdown', closeMenuOutside)
  else window.removeEventListener('pointerdown', closeMenuOutside)
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeMenuOutside))

// ---------------------------------------------------------------- actions

async function toggleFavorite() {
  if (document.value) await store.setFavorite(document.value.id, !document.value.favorite)
}

async function addChild() {
  const created = await store.createDocument({
    workspaceId: workspaceId.value,
    parentId: documentId,
  })
  await router.push({
    name: 'page',
    params: { workspaceId: workspaceId.value, documentId: created.id },
  })
}

async function deletePage() {
  if (!document.value) return
  const count = children.value.length
  const message = count
    ? `„${displayTitle(document.value)}“ und alle Unterseiten löschen?`
    : `„${displayTitle(document.value)}“ löschen?`
  if (!window.confirm(message)) return
  const parentId = document.value.parentId
  await store.deleteDocument(document.value.id)
  await router.push(
    parentId
      ? { name: 'page', params: { workspaceId: workspaceId.value, documentId: parentId } }
      : { name: 'workspace', params: { workspaceId: workspaceId.value } },
  )
}
</script>

<template>
  <article v-if="document" class="page">
    <p v-if="conflicts.length" class="error conflict-banner" data-testid="page-conflicts">
      Diese Seite hat {{ conflicts.length }} offene{{
        conflicts.length === 1 ? 'n' : ''
      }}
      Konflikt{{ conflicts.length === 1 ? '' : 'e' }}.
      <RouterLink :to="{ name: 'conflicts', params: { workspaceId } }">Anzeigen</RouterLink>
    </p>
    <header class="page-header">
      <nav class="breadcrumbs" aria-label="Pfad">
        <template v-for="ancestor in ancestors" :key="ancestor.id">
          <RouterLink :to="{ name: 'page', params: { workspaceId, documentId: ancestor.id } }">
            {{ displayTitle(ancestor) }}
          </RouterLink>
          <span aria-hidden="true">/</span>
        </template>
        <span>{{ displayTitle(document) }}</span>
      </nav>
      <div class="page-actions">
        <span class="muted edited" data-testid="page-edited">Bearbeitet {{ edited }}</span>
        <button
          type="button"
          class="icon"
          :aria-pressed="document.favorite"
          :aria-label="document.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'"
          :title="document.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'"
          @click="toggleFavorite"
        >
          {{ document.favorite ? '★' : '☆' }}
        </button>
        <div ref="menuRoot" class="page-menu" @keydown.escape="menuOpen = false">
          <button
            type="button"
            class="icon"
            aria-label="Seitenmenü"
            title="Seitenmenü"
            aria-haspopup="true"
            :aria-expanded="menuOpen"
            data-testid="page-menu"
            @click="menuOpen = !menuOpen"
          >
            ⋯
          </button>
          <div v-if="menuOpen" class="block-menu page-menu-list" @click="menuOpen = false">
            <button type="button" @click="addChild">Unterseite anlegen</button>
            <RouterLink :to="{ name: 'history', params: { workspaceId, documentId } }">
              Verlauf
            </RouterLink>
            <RouterLink :to="{ name: 'export', params: { workspaceId } }">
              Export & Import
            </RouterLink>
            <div class="separator" role="separator"></div>
            <button type="button" class="danger" @click="deletePage">Löschen</button>
          </div>
        </div>
      </div>
    </header>

    <input
      ref="titleInput"
      v-model="title"
      class="page-title"
      placeholder="Unbenannt"
      aria-label="Titel"
      :readonly="content !== 'loaded'"
      :maxlength="DOCUMENT_TITLE_MAX_LENGTH"
      @input="onTitleInput"
      @blur="saveTitle"
      @keydown.enter.prevent="focusFirstBlock"
    />

    <template v-if="content === 'loaded'">
      <TagBar :document-id="document.id" />
      <PageEditor :document-id="document.id" />
    </template>
    <p v-else-if="content === 'loading'" class="muted" data-testid="page-content-loading">
      Inhalt wird geladen …
    </p>
    <p v-else class="notice" role="status" data-testid="page-content-unavailable">
      <template v-if="content === 'offline'">
        Der Inhalt dieser Seite ist nicht auf diesem Gerät. Er wird geladen, sobald der Server
        erreichbar ist. Damit alle Seiten auch ohne Verbindung da sind:
        <RouterLink :to="{ name: 'account' }">Konto → Offline verfügbar</RouterLink>.
      </template>
      <template v-else-if="content === 'missing'">
        Der Inhalt dieser Seite ist auf dem Server nicht verfügbar.
      </template>
      <template v-else>
        Der Inhalt dieser Seite konnte nicht geladen werden.
        <button type="button" class="secondary" @click="loadContent">Erneut versuchen</button>
      </template>
    </p>

    <section v-if="children.length" class="page-section" aria-labelledby="subpages">
      <h2 id="subpages">Unterseiten</h2>
      <ul class="link-list">
        <li v-for="child in children" :key="child.id">
          <RouterLink :to="{ name: 'page', params: { workspaceId, documentId: child.id } }">
            {{ displayTitle(child) }}
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="page-section" aria-labelledby="backlinks">
      <h2 id="backlinks">Verlinkt von</h2>
      <ul v-if="backlinks.length" class="link-list">
        <li v-for="source in backlinks" :key="source.id">
          <RouterLink :to="{ name: 'page', params: { workspaceId, documentId: source.id } }">
            {{ displayTitle(source) }}
          </RouterLink>
        </li>
      </ul>
      <p v-else class="muted">Keine Seite verlinkt hierher. Mit <kbd>[[</kbd> im Text verlinken.</p>
      <p v-if="unloadedCount" class="muted" data-testid="backlinks-partial">
        Berücksichtigt sind Seiten, deren Inhalt auf diesem Gerät ist ({{
          unloadedCount.toLocaleString('de-DE')
        }}
        weitere nicht).
      </p>
    </section>
  </article>

  <section v-else-if="loaded === null" class="page empty-state">
    <h1>Seite nicht gefunden</h1>
    <p class="muted">Die Seite wurde gelöscht oder existiert auf diesem Gerät nicht.</p>
    <RouterLink :to="{ name: 'workspace', params: { workspaceId } }">Zur Übersicht</RouterLink>
  </section>
</template>
