<script setup lang="ts">
import type { Document } from '@notion-alt/shared'
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import TreeNode from '../components/TreeNode.vue'
import { useLiveQuery } from '../composables/live-query'
import { expanded } from '../composables/tree-state'
import { displayTitle, workspaceKey } from '../composables/workspace'
import { deviceStatus } from '../device'
import {
  persistence,
  refreshWorkspaces,
  rememberWorkspace,
  requestPersistence,
  requireStore,
  workspaces,
  workspaceSearch,
} from '../local/context'
import type { SearchHit } from '../local/search'
import { connection, currentUser, refreshSession } from '../session'
import { requestSync, syncState } from '../sync/engine'

const route = useRoute()
const router = useRouter()
const store = requireStore()

const workspaceId = computed(() => String(route.params.workspaceId))
const documents = useLiveQuery<Document[]>(
  () => store.listDocuments(workspaceId.value),
  [],
  workspaceId,
)
const documentsById = computed(() => new Map(documents.value.map((d) => [d.id, d])))
provide(workspaceKey, { store, workspaceId, documents, documentsById })

const workspace = computed(() => workspaces.value.find((w) => w.id === workspaceId.value))
const roots = computed(() => documents.value.filter((d) => d.parentId === null))
const favorites = computed(() =>
  documents.value
    .filter((d) => d.favorite)
    .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b))),
)
const recent = computed(() =>
  [...documents.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
)
const tags = useLiveQuery(() => store.listTags(workspaceId.value), [], workspaceId)
const pending = useLiveQuery(() => store.pendingOperationCount(), 0)
const withIssues = useLiveQuery(() => store.operationsWithIssues(), [])
const conflicts = computed(() => withIssues.value.filter((op) => op.issue?.status === 'conflict'))
const rejected = computed(() => withIssues.value.filter((op) => op.issue?.status === 'rejected'))

watch(workspaceId, (id) => rememberWorkspace(id), { immediate: true })

// Expand the ancestors of the open page so it is visible in the tree.
watch(
  [() => route.params.documentId, documentsById],
  ([id]) => {
    let parentId = typeof id === 'string' ? documentsById.value.get(id)?.parentId : null
    while (parentId) {
      expanded.add(parentId)
      parentId = documentsById.value.get(parentId)?.parentId ?? null
    }
  },
  { immediate: true },
)

// ---------------------------------------------------------------- search

const query = ref('')
const hits = ref<SearchHit[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch([query, documents], () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    if (!query.value.trim()) {
      hits.value = []
      return
    }
    const search = await workspaceSearch(store, workspaceId.value)
    await search.flush()
    hits.value = search.index.search(query.value)
  }, 120)
})

async function openHit(hit: SearchHit) {
  query.value = ''
  await router.push({
    name: 'page',
    params: { workspaceId: workspaceId.value, documentId: hit.id },
  })
}

// ---------------------------------------------------------------- actions

async function createPage() {
  const created = await store.createDocument({ workspaceId: workspaceId.value })
  await router.push({
    name: 'page',
    params: { workspaceId: workspaceId.value, documentId: created.id },
  })
}

// ---------------------------------------------------------------- connection

async function recheck() {
  try {
    if ((await refreshSession()) === 'online') {
      await refreshWorkspaces(store)
      void requestSync(store)
    }
  } catch {
    connection.value = 'offline'
  }
}

// Push local changes shortly after they were made (debounced); the queue keeps them meanwhile.
const SYNC_AFTER_CHANGE_MS = 1500
let changeTimer: ReturnType<typeof setTimeout> | null = null
const stopChangeListener = store.onChange(() => {
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void requestSync(store), SYNC_AFTER_CHANGE_MS)
})

let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void recheck()
  window.addEventListener('online', recheck)
  window.addEventListener('offline', markOffline)
  window.addEventListener('focus', recheck)
  interval = setInterval(recheck, 60_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', recheck)
  window.removeEventListener('offline', markOffline)
  window.removeEventListener('focus', recheck)
  if (interval) clearInterval(interval)
  if (changeTimer) clearTimeout(changeTimer)
  stopChangeListener()
})

function markOffline() {
  connection.value = 'offline'
}

const connectionLabel = computed(
  () =>
    ({
      online: 'Server verbunden',
      offline: 'Offline – lokale Daten',
      expired: 'Sitzung abgelaufen',
    })[connection.value],
)

const persistenceLabel = computed(
  () =>
    ({
      persisted: 'Speicher dauerhaft',
      'not-persisted': 'Speicher nicht dauerhaft',
      unsupported: 'Dauerhafter Speicher nicht unterstützt',
      unknown: 'Speicherstatus unbekannt',
    })[persistence.value],
)

const sidebarOpen = ref(false)
watch(
  () => route.fullPath,
  () => (sidebarOpen.value = false),
)
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-open': sidebarOpen }">
    <button
      type="button"
      class="sidebar-toggle"
      :aria-expanded="sidebarOpen"
      aria-controls="sidebar"
      @click="sidebarOpen = !sidebarOpen"
    >
      ☰ <span class="visually-hidden">Navigation</span>
    </button>

    <aside id="sidebar" class="sidebar" aria-label="Navigation">
      <header class="sidebar-header">
        <RouterLink class="workspace-name" :to="{ name: 'home', query: { choose: '1' } }">
          {{ workspace?.name ?? 'Workspace' }}
        </RouterLink>
      </header>

      <input
        v-model="query"
        class="search"
        type="search"
        placeholder="Suchen…"
        aria-label="Seiten durchsuchen"
        @keydown.enter="hits[0] && openHit(hits[0])"
        @keydown.escape="query = ''"
      />

      <section v-if="query.trim()" class="nav-section" aria-label="Suchergebnisse">
        <ul class="nav-list search-results">
          <li v-for="hit in hits" :key="hit.id">
            <button type="button" class="nav-item" @click="openHit(hit)">
              <strong>{{ hit.title || 'Unbenannt' }}</strong>
              <small v-if="hit.snippet" class="muted">{{ hit.snippet }}</small>
            </button>
          </li>
        </ul>
        <p v-if="hits.length === 0" class="muted empty">Keine Treffer</p>
      </section>

      <template v-else>
        <section v-if="favorites.length" class="nav-section" aria-labelledby="nav-favorites">
          <h2 id="nav-favorites">Favoriten</h2>
          <ul class="nav-list">
            <li v-for="doc in favorites" :key="doc.id">
              <RouterLink
                class="nav-item"
                :to="{ name: 'page', params: { workspaceId, documentId: doc.id } }"
              >
                ★ {{ displayTitle(doc) }}
              </RouterLink>
            </li>
          </ul>
        </section>

        <section v-if="recent.length" class="nav-section" aria-labelledby="nav-recent">
          <h2 id="nav-recent">Zuletzt bearbeitet</h2>
          <ul class="nav-list">
            <li v-for="doc in recent" :key="doc.id">
              <RouterLink
                class="nav-item"
                :to="{ name: 'page', params: { workspaceId, documentId: doc.id } }"
              >
                {{ displayTitle(doc) }}
              </RouterLink>
            </li>
          </ul>
        </section>

        <section class="nav-section" aria-labelledby="nav-pages">
          <h2 id="nav-pages" class="row">
            Seiten
            <button
              type="button"
              class="icon"
              aria-label="Neue Seite"
              title="Neue Seite"
              @click="createPage"
            >
              +
            </button>
          </h2>
          <ul class="tree" role="tree" aria-labelledby="nav-pages">
            <TreeNode v-for="doc in roots" :key="doc.id" :document="doc" :depth="0" />
          </ul>
          <p v-if="roots.length === 0" class="muted empty">Noch keine Seiten</p>
        </section>

        <section v-if="tags.length" class="nav-section" aria-labelledby="nav-tags">
          <h2 id="nav-tags">Tags</h2>
          <div class="tag-cloud">
            <RouterLink
              v-for="tag in tags"
              :key="tag.id"
              class="tag"
              :to="{ name: 'tag', params: { workspaceId, tagId: tag.id } }"
            >
              #{{ tag.name }}
            </RouterLink>
          </div>
        </section>
      </template>

      <footer class="sidebar-footer">
        <p class="status" :class="`status-${connection}`" data-testid="connection">
          <span class="dot" aria-hidden="true"></span>{{ connectionLabel }}
          <RouterLink v-if="connection === 'expired'" :to="{ name: 'login' }">Anmelden</RouterLink>
        </p>
        <p class="status" :class="`status-${persistence}`" data-testid="persistence">
          {{ persistenceLabel }}
          <button
            v-if="persistence === 'not-persisted'"
            type="button"
            class="link"
            @click="requestPersistence"
          >
            Erneut anfragen
          </button>
        </p>
        <p v-if="persistence === 'not-persisted'" class="hint muted">
          Der Browser darf lokale Daten bei Speichermangel löschen. Tipp: App installieren oder
          regelmäßig exportieren.
        </p>
        <p v-if="deviceStatus === 'revoked'" class="error" data-testid="device-revoked">
          Dieses Gerät wurde aus dem Konto entfernt. Lokale Daten bleiben erhalten, werden aber
          nicht mehr synchronisiert.
        </p>
        <p class="muted" data-testid="pending">
          {{ pending }} lokale Änderung{{ pending === 1 ? '' : 'en' }} noch nicht synchronisiert
        </p>
        <p v-if="conflicts.length" class="error" data-testid="sync-conflicts">
          {{ conflicts.length }} Änderung{{ conflicts.length === 1 ? '' : 'en' }} mit Konflikt: auf
          einem anderen Gerät geändert oder gelöscht. Sie bleiben lokal erhalten, bis die
          Konfliktauflösung verfügbar ist.
        </p>
        <p v-if="rejected.length" class="error" data-testid="sync-rejected">
          {{ rejected.length }} Änderung{{ rejected.length === 1 ? '' : 'en' }} vom Server abgelehnt
          ({{ rejected[0]?.issue?.message }}). Sie bleiben lokal erhalten.
        </p>
        <p v-if="syncState.lastError && connection === 'online'" class="muted">
          Synchronisierung fehlgeschlagen, neuer Versuch folgt.
        </p>
        <p class="muted">
          {{ currentUser?.email }} ·
          <RouterLink :to="{ name: 'account' }">Konto</RouterLink>
        </p>
      </footer>
    </aside>

    <main class="content">
      <RouterView :key="String(route.params.documentId ?? route.params.tagId ?? '')" />
    </main>
  </div>
</template>
