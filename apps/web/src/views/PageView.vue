<script setup lang="ts">
import { DOCUMENT_TITLE_MAX_LENGTH, type Document } from '@notion-alt/shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TagBar from '../components/TagBar.vue'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, NO_CHILDREN, useWorkspace } from '../composables/workspace'
import PageEditor from '../editor/PageEditor.vue'
import { registerPendingEdits } from '../pending-edits'

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
const backlinks = useLiveQuery(() => store.backlinks(documentId), [])
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
        <button type="button" class="secondary" @click="addChild">+ Unterseite</button>
        <RouterLink
          class="secondary"
          :to="{ name: 'history', params: { workspaceId, documentId } }"
        >
          Verlauf
        </RouterLink>
        <button type="button" class="secondary danger" @click="deletePage">Löschen</button>
      </div>
    </header>

    <input
      ref="titleInput"
      v-model="title"
      class="page-title"
      placeholder="Unbenannt"
      aria-label="Titel"
      :maxlength="DOCUMENT_TITLE_MAX_LENGTH"
      @input="onTitleInput"
      @blur="saveTitle"
      @keydown.enter.prevent="focusFirstBlock"
    />

    <TagBar :document-id="document.id" />

    <PageEditor :document-id="document.id" />

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
    </section>
  </article>

  <section v-else-if="loaded === null" class="page empty-state">
    <h1>Seite nicht gefunden</h1>
    <p class="muted">Die Seite wurde gelöscht oder existiert auf diesem Gerät nicht.</p>
    <RouterLink :to="{ name: 'workspace', params: { workspaceId } }">Zur Übersicht</RouterLink>
  </section>
</template>
