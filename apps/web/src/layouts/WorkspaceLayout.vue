<script setup lang="ts">
import type { Document, ServerSearchHit } from '@notion-alt/shared'
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import TreeNode from '../components/TreeNode.vue'
import { useLiveQuery } from '../composables/live-query'
import { expanded } from '../composables/tree-state'
import {
  displayTitle,
  groupByParent,
  NO_CHILDREN,
  reuseUnchanged,
  workspaceKey,
} from '../composables/workspace'
import { deviceStatus } from '../device'
import { dismissIosHint, installApp, installPrompt, showIosHint } from '../install'
import { refreshAttachmentUsage } from '../limits'
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
import { onPushHint } from '../pwa'
import { onSyncHint, requestSync, syncState } from '../sync/engine'
import { DEFAULT_TRIGGERS, startSyncTriggers } from '../sync/triggers'

const route = useRoute()
const router = useRouter()
const store = requireStore()

const workspaceId = computed(() => String(route.params.workspaceId))
const loadedDocuments = useLiveQuery<Document[]>(
  () => store.listDocuments(workspaceId.value),
  [],
  workspaceId,
)
let previousDocuments: Document[] = []
const documents = computed(() => {
  previousDocuments = reuseUnchanged(previousDocuments, loadedDocuments.value)
  return previousDocuments
})
const documentsById = computed(() => new Map(documents.value.map((d) => [d.id, d])))
let previousGroups: Map<string | null, Document[]> | undefined
const childrenByParent = computed(() => {
  previousGroups = groupByParent(documents.value, previousGroups)
  return previousGroups
})
const activeDocumentId = computed(() =>
  typeof route.params.documentId === 'string' ? route.params.documentId : null,
)
// Resolved once per workspace; 10 000 tree links each resolving their route took a noticeable
// part of the cold start (#102).
const PAGE_ID = '__page__'
const pageHrefTemplate = computed(
  () =>
    router.resolve({
      name: 'page',
      params: { workspaceId: workspaceId.value, documentId: PAGE_ID },
    }).href,
)
const pageHref = (documentId: string) =>
  pageHrefTemplate.value.replace(PAGE_ID, encodeURIComponent(documentId))
provide(workspaceKey, {
  store,
  workspaceId,
  documents,
  documentsById,
  childrenByParent,
  activeDocumentId,
  pageHref,
})

const workspace = computed(() => workspaces.value.find((w) => w.id === workspaceId.value))
const roots = computed(() => childrenByParent.value.get(null) ?? NO_CHILDREN)
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
const conflicts = useLiveQuery(() => store.openConflicts(workspaceId.value), [], workspaceId)
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

/**
 * Server-side hits (FTS5) only complement the local search, e.g. for pages not synced to this
 * device yet; offline the local search is all there is.
 */
const serverHits = ref<ServerSearchHit[]>([])
let serverTimer: ReturnType<typeof setTimeout> | null = null
watch([query, workspaceId], () => {
  if (serverTimer) clearTimeout(serverTimer)
  serverHits.value = []
  const q = query.value.trim()
  if (q.length < 2 || connection.value !== 'online') return
  serverTimer = setTimeout(async () => {
    try {
      const { hits: found } = await api.search(workspaceId.value, q)
      if (query.value.trim() === q) serverHits.value = found
    } catch {
      // Server unreachable: local results stand on their own.
    }
  }, 300)
})
const extraServerHits = computed(() => {
  const local = new Set(hits.value.map((hit) => hit.id))
  return serverHits.value.filter((hit) => !local.has(hit.documentId))
})

async function openServerHit(hit: ServerSearchHit) {
  query.value = ''
  // Not on this device yet: fetch it first.
  if (!documentsById.value.has(hit.documentId)) await requestSync(store)
  await router.push({
    name: 'page',
    params: { workspaceId: workspaceId.value, documentId: hit.documentId },
  })
}

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
      void refreshAttachmentUsage(workspaceId.value)
    }
  } catch {
    connection.value = 'offline'
  }
}

// Local changes are pushed shortly after they were made; the queue keeps them meanwhile.
let triggers: ReturnType<typeof startSyncTriggers> | null = null
const stopChangeListener = store.onChange(() => triggers?.changed())
const stopPushHints = onPushHint(() => void onSyncHint(store))

onMounted(() => {
  triggers = startSyncTriggers(recheck, DEFAULT_TRIGGERS, () => requestSync(store))
  window.addEventListener('offline', markOffline)
})
onBeforeUnmount(() => {
  triggers?.stop()
  window.removeEventListener('offline', markOffline)
  stopChangeListener()
  stopPushHints()
})

async function syncNow() {
  await recheck()
}

const timeFormat = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' })

/** One line telling whether local data is on the server. */
const syncLabel = computed(() => {
  if (connection.value !== 'online') return null
  const resync = syncState.value.resync
  if (resync) {
    const percent = resync.total ? Math.floor((resync.done / resync.total) * 100) : 0
    return `Neu synchronisieren… ${percent} %`
  }
  if (syncState.value.running) return 'Synchronisiert…'
  if (syncState.value.lastError) return 'Synchronisierung fehlgeschlagen – neuer Versuch folgt'
  if (pending.value > withIssues.value.length) return 'Änderungen ausstehend'
  const at = syncState.value.lastSyncAt
  return at ? `Synchronisiert um ${timeFormat.format(new Date(at))}` : 'Noch nicht synchronisiert'
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
        <p v-if="hits.length === 0 && extraServerHits.length === 0" class="muted empty">
          Keine Treffer
        </p>
        <template v-if="extraServerHits.length">
          <h2 id="nav-server-hits">Weitere Treffer vom Server</h2>
          <ul class="nav-list search-results" aria-labelledby="nav-server-hits">
            <li v-for="hit in extraServerHits" :key="hit.documentId">
              <button type="button" class="nav-item" @click="openServerHit(hit)">
                <strong>{{ hit.title || 'Unbenannt' }}</strong>
                <small v-if="hit.snippet" class="muted">{{ hit.snippet }}</small>
              </button>
            </li>
          </ul>
        </template>
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
          Dieses Gerät wurde aus dem Konto entfernt. Lokale Daten bleiben erhalten. Nach erneuter
          Anmeldung synchronisiert es als neues Gerät weiter.
        </p>
        <p v-if="installPrompt" class="status">
          <button type="button" class="link" @click="installApp">App installieren</button>
          – startet wie eine eigene App, auch offline.
        </p>
        <p v-if="showIosHint" class="hint muted" data-testid="ios-install-hint">
          Als App installieren: in Safari <strong>Teilen</strong> →
          <strong>„Zum Home-Bildschirm“</strong>. Erst dann bleiben die lokalen Daten dauerhaft
          gespeichert, und Benachrichtigungen sind möglich.
          <button type="button" class="link" @click="dismissIosHint">Ausblenden</button>
        </p>
        <p class="muted" data-testid="pending">
          {{ pending }} lokale Änderung{{ pending === 1 ? '' : 'en' }} noch nicht synchronisiert
        </p>
        <p v-if="conflicts.length" class="error" data-testid="sync-conflicts">
          <RouterLink :to="{ name: 'conflicts', params: { workspaceId } }">
            {{ conflicts.length }} Konflikt{{ conflicts.length === 1 ? '' : 'e' }}
          </RouterLink>
          – gleichzeitige Änderungen auf mehreren Geräten. Beide Stände sind erhalten.
        </p>
        <p v-if="rejected.length" class="error" data-testid="sync-rejected">
          {{ rejected.length }} Änderung{{ rejected.length === 1 ? '' : 'en' }} vom Server abgelehnt
          ({{ rejected[0]?.issue?.message }}). Sie bleiben lokal erhalten.
        </p>
        <p v-if="syncLabel" class="muted sync-status" data-testid="sync-status">
          {{ syncLabel }}
          <button type="button" class="link" :disabled="syncState.running" @click="syncNow">
            Jetzt synchronisieren
          </button>
        </p>
        <p class="muted">
          {{ currentUser?.email }} · <RouterLink :to="{ name: 'account' }">Konto</RouterLink> ·
          <RouterLink :to="{ name: 'trash', params: { workspaceId } }">Papierkorb</RouterLink> ·
          <RouterLink :to="{ name: 'export', params: { workspaceId } }">Export & Import</RouterLink>
        </p>
      </footer>
    </aside>

    <main class="content">
      <RouterView :key="String(route.params.documentId ?? route.params.tagId ?? '')" />
    </main>
  </div>
</template>
