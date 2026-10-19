<script setup lang="ts">
import type { Document, ServerSearchHit } from '@notion-alt/shared'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import TreeNode from '../components/TreeNode.vue'
import { useLiveQuery } from '../composables/live-query'
import { FINE_POINTER, NARROW, useMediaQuery } from '../composables/media'
import CommandPalette from '../components/CommandPalette.vue'
import NavIcon from '../components/NavIcon.vue'
import ShortcutsDialog from '../components/ShortcutsDialog.vue'
import SyncStatus from '../components/SyncStatus.vue'
import WorkspaceMenu from '../components/WorkspaceMenu.vue'
import { loadRecentPages, rememberVisit } from '../composables/recent-pages'
import {
  setSidebarCollapsed,
  setSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarCollapsed,
  sidebarWidth,
} from '../composables/sidebar'
import { expanded } from '../composables/tree-state'
import {
  displayTitle,
  pageLabel,
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
import { type SearchHit, withoutMarkdownMarkers } from '../local/search'
import { connection, refreshSession } from '../session'
import { onPushHint } from '../pwa'
import { onSyncHint, requestSync } from '../sync/engine'
import { DEFAULT_TRIGGERS, startSyncTriggers } from '../sync/triggers'
import { shortcutFor } from '../shortcuts'
import { ROLE_LABELS } from '../sharing'
import { toggleTheme } from '../theme'

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
const workspace = computed(() => workspaces.value.find((w) => w.id === workspaceId.value))
// Servers before ADR 0014 send no role: the user owns every workspace there. A workspace not
// in the list yet (opened by link before the first refresh) stays read-only until it is known.
const role = computed(() => workspace.value?.role ?? (workspace.value ? 'owner' : 'reader'))
const revoked = computed(() => !!workspace.value?.revoked)
const readOnly = computed(
  () => revoked.value || role.value === 'reader' || role.value === 'commenter',
)
provide(workspaceKey, {
  store,
  workspaceId,
  documents,
  documentsById,
  childrenByParent,
  activeDocumentId,
  pageHref,
  role,
  readOnly,
})
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
const rejected = computed(() =>
  withIssues.value.filter(
    (op) => op.issue?.status === 'rejected' && op.workspaceId === workspaceId.value,
  ),
)

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
/** Pages whose content is not on this device (ADR 0017): offline, search covers only titles. */
const unloadedCount = useLiveQuery(
  async () => (await store.unloadedDocuments(workspaceId.value)).length,
  0,
  workspaceId,
)
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
  if (readOnly.value) return
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
    if (connection.value !== 'local') connection.value = 'offline'
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

function markOffline() {
  // Without an account there is no server to lose.
  if (connection.value !== 'local') connection.value = 'offline'
}

// ---------------------------------------------------------------- storage hint (#195)

const PERSISTENCE_HINT_KEY = 'notion-alt.persistenceHintDismissed'
function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(PERSISTENCE_HINT_KEY) === '1'
  } catch {
    return false
  }
}
const persistenceHintDismissed = ref(readHintDismissed())
/**
 * The browser may delete local data under storage pressure. Say so once there is something to
 * lose; after dismissing it the state stays in the status details and the settings.
 */
const showPersistenceHint = computed(
  () =>
    persistence.value === 'not-persisted' &&
    !persistenceHintDismissed.value &&
    documents.value.length > 0,
)
function dismissPersistenceHint() {
  persistenceHintDismissed.value = true
  try {
    localStorage.setItem(PERSISTENCE_HINT_KEY, '1')
  } catch {
    // Private mode: hidden for this visit only.
  }
}

// ---------------------------------------------------------------- sidebar (#132, #201)

const narrow = useMediaQuery(NARROW)
/** Shortcut hints only where there is a keyboard. */
const keyboard = useMediaQuery(FINE_POINTER, true)
const sidebarOpen = ref(false)
/** The sidebar lies over the content (narrow screens). */
const overlay = computed(() => narrow.value && sidebarOpen.value)
const sidebar = ref<HTMLElement | null>(null)
const sidebarToggle = ref<HTMLButtonElement | null>(null)

watch(
  () => route.fullPath,
  () => closeSidebar(false),
)
watch(narrow, (isNarrow) => {
  if (!isNarrow) sidebarOpen.value = false
})

async function openSidebar() {
  sidebarOpen.value = true
  await nextTick()
  focusables()[0]?.focus()
}

function closeSidebar(returnFocus = true) {
  if (!sidebarOpen.value) return
  sidebarOpen.value = false
  if (returnFocus) void nextTick(() => sidebarToggle.value?.focus())
}

/** Ctrl/⌘ + \ shows or hides the sidebar; on narrow screens it opens the overlay. */
function toggleSidebar() {
  if (narrow.value) {
    if (sidebarOpen.value) closeSidebar()
    else void openSidebar()
  } else setSidebarCollapsed(!sidebarCollapsed.value)
}

function focusables(): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]'
  return [...(sidebar.value?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(
    (el) => el.offsetParent !== null,
  )
}

/** While the overlay is open, Esc closes it and Tab stays inside (#201). */
function onSidebarKeydown(event: KeyboardEvent) {
  if (!overlay.value) return
  if (event.key === 'Escape' && !event.defaultPrevented) {
    event.preventDefault()
    closeSidebar()
  } else if (event.key === 'Tab') {
    const items = focusables()
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

/** Swiping the overlay to the left closes it. */
let touchStart: { x: number; y: number } | null = null
function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  touchStart = overlay.value && touch ? { x: touch.clientX, y: touch.clientY } : null
}
function onTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (!touchStart || !touch) return
  const dx = touch.clientX - touchStart.x
  const dy = touch.clientY - touchStart.y
  touchStart = null
  if (dx < -60 && Math.abs(dx) > Math.abs(dy)) closeSidebar()
}

// ---------------------------------------------------------------- shortcuts, quick search (#134)

const paletteOpen = ref(false)
const shortcutsOpen = ref(false)

function onShortcut(event: KeyboardEvent) {
  const command = shortcutFor(event)
  if (!command) return
  event.preventDefault()
  if (command === 'palette') {
    shortcutsOpen.value = false
    paletteOpen.value = !paletteOpen.value
  } else if (command === 'newPage') void createPage()
  else if (command === 'toggleTheme') toggleTheme()
  else if (command === 'sidebar') toggleSidebar()
  else if (command === 'shortcuts') {
    paletteOpen.value = false
    shortcutsOpen.value = !shortcutsOpen.value
  }
}

watch(workspaceId, (id) => loadRecentPages(id), { immediate: true })
watch(
  activeDocumentId,
  (id) => {
    if (id) rememberVisit(workspaceId.value, id)
  },
  { immediate: true },
)

function showShortcuts() {
  paletteOpen.value = false
  shortcutsOpen.value = true
}
onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut))

/** Width by dragging the edge, or with the arrow keys on the focused edge. */
function startResize(event: PointerEvent) {
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture?.(event.pointerId)
  const move = (e: PointerEvent) => (sidebarWidth.value = Math.round(e.clientX))
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    setSidebarWidth(sidebarWidth.value)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

function resizeByKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 64 : 16
  if (event.key === 'ArrowLeft') setSidebarWidth(sidebarWidth.value - step)
  else if (event.key === 'ArrowRight') setSidebarWidth(sidebarWidth.value + step)
  else return
  event.preventDefault()
}

const shellStyle = computed(() => ({
  '--sidebar-width': `${Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth.value))}px`,
}))
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'sidebar-open': sidebarOpen, 'sidebar-collapsed': sidebarCollapsed }"
    :style="shellStyle"
  >
    <button
      ref="sidebarToggle"
      type="button"
      class="sidebar-toggle"
      :aria-expanded="sidebarOpen"
      aria-controls="sidebar"
      @click="toggleSidebar"
    >
      ☰ <span class="visually-hidden">Navigation</span>
    </button>
    <div
      v-if="overlay"
      class="sidebar-scrim"
      aria-hidden="true"
      data-testid="sidebar-scrim"
      @click="closeSidebar()"
    ></div>
    <button
      v-if="sidebarCollapsed"
      type="button"
      class="icon sidebar-expand"
      aria-label="Seitenleiste einblenden"
      title="Seitenleiste einblenden (Strg/⌘ + \)"
      data-testid="sidebar-expand"
      @click="setSidebarCollapsed(false)"
    >
      »
    </button>

    <aside
      id="sidebar"
      ref="sidebar"
      class="sidebar"
      aria-label="Navigation"
      @keydown="onSidebarKeydown"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <header class="sidebar-header">
        <WorkspaceMenu :workspace-id="workspaceId" />
        <button
          type="button"
          class="icon sidebar-collapse"
          aria-label="Seitenleiste ausblenden"
          :title="keyboard ? 'Seitenleiste ausblenden (Strg/⌘ + \\)' : 'Seitenleiste ausblenden'"
          data-testid="sidebar-collapse"
          @click="narrow ? closeSidebar() : setSidebarCollapsed(true)"
        >
          «
        </button>
      </header>

      <input
        v-model="query"
        class="search"
        type="search"
        :placeholder="keyboard ? 'Suchen… (Strg/⌘ + K)' : 'Suchen…'"
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
        <p
          v-if="connection !== 'online' && unloadedCount"
          class="muted empty"
          data-testid="search-partial"
        >
          Offline wird nur der Inhalt von Seiten auf diesem Gerät durchsucht; bei
          {{ unloadedCount.toLocaleString('de-DE') }} weiteren nur der Titel.
        </p>
        <template v-if="extraServerHits.length">
          <h2 id="nav-server-hits">Weitere Treffer vom Server</h2>
          <ul class="nav-list search-results" aria-labelledby="nav-server-hits">
            <li v-for="hit in extraServerHits" :key="hit.documentId">
              <button type="button" class="nav-item" @click="openServerHit(hit)">
                <strong>{{ hit.title || 'Unbenannt' }}</strong>
                <small v-if="hit.snippet" class="muted">{{
                  withoutMarkdownMarkers(hit.snippet)
                }}</small>
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
                ★ {{ pageLabel(doc) }}
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
                {{ pageLabel(doc) }}
              </RouterLink>
            </li>
          </ul>
        </section>

        <section class="nav-section" aria-labelledby="nav-pages">
          <h2 id="nav-pages" class="row">
            Seiten
            <button
              v-if="!readOnly"
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

      <nav class="nav-section nav-tools" aria-label="Werkzeuge">
        <ul class="nav-list">
          <li v-if="connection !== 'local'">
            <RouterLink class="nav-item nav-tool" :to="{ name: 'account' }">
              <NavIcon name="settings" />Einstellungen
            </RouterLink>
          </li>
          <li v-if="connection !== 'local'">
            <RouterLink
              class="nav-item nav-tool"
              :to="{ name: 'members', params: { workspaceId } }"
            >
              <NavIcon name="members" />Mitglieder
            </RouterLink>
          </li>
          <li>
            <RouterLink class="nav-item nav-tool" :to="{ name: 'trash', params: { workspaceId } }">
              <NavIcon name="trash" />Papierkorb
            </RouterLink>
          </li>
          <li>
            <RouterLink class="nav-item nav-tool" :to="{ name: 'export', params: { workspaceId } }">
              <NavIcon name="export" />Export & Import
            </RouterLink>
          </li>
          <li v-if="keyboard">
            <button type="button" class="nav-item nav-tool" @click="showShortcuts">
              <NavIcon name="keyboard" />Tastenkürzel
            </button>
          </li>
        </ul>
      </nav>

      <footer class="sidebar-footer">
        <p v-if="conflicts.length" class="error" data-testid="sync-conflicts">
          <RouterLink :to="{ name: 'conflicts', params: { workspaceId } }">
            {{ conflicts.length }} Konflikt{{ conflicts.length === 1 ? '' : 'e' }}
          </RouterLink>
          – gleichzeitige Änderungen auf mehreren Geräten. Beide Stände sind erhalten.
        </p>
        <p v-if="rejected.length" class="error" data-testid="sync-rejected">
          <RouterLink :to="{ name: 'rejected', params: { workspaceId } }">
            {{ rejected.length }} Änderung{{ rejected.length === 1 ? '' : 'en' }} vom Server
            abgelehnt</RouterLink
          >. Sie bleiben lokal erhalten.
        </p>
        <p v-if="deviceStatus === 'revoked'" class="error" data-testid="device-revoked">
          Dieses Gerät wurde aus dem Konto entfernt. Lokale Daten bleiben erhalten. Nach erneuter
          Anmeldung synchronisiert es als neues Gerät weiter.
        </p>
        <p v-if="showPersistenceHint" class="hint" data-testid="persistence-hint">
          Der Browser darf lokale Daten bei Speichermangel löschen. Tipp: App installieren oder
          regelmäßig exportieren.
          <button type="button" class="link" @click="requestPersistence">
            Dauerhaft speichern
          </button>
          ·
          <button type="button" class="link" @click="dismissPersistenceHint">Ausblenden</button>
        </p>
        <p v-if="installPrompt" class="hint">
          <button type="button" class="link" @click="installApp">App installieren</button>
          – startet wie eine eigene App, auch offline.
        </p>
        <p v-if="showIosHint" class="hint muted" data-testid="ios-install-hint">
          Als App installieren: in Safari <strong>Teilen</strong> →
          <strong>„Zum Home-Bildschirm“</strong>. Erst dann bleiben die lokalen Daten dauerhaft
          gespeichert, und Benachrichtigungen sind möglich.
          <button type="button" class="link" @click="dismissIosHint">Ausblenden</button>
        </p>
        <SyncStatus :pending="pending" :with-issues="withIssues.length" @sync="syncNow" />
      </footer>
    </aside>
    <div
      v-if="!sidebarCollapsed"
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der Seitenleiste"
      :aria-valuenow="sidebarWidth"
      :aria-valuemin="SIDEBAR_MIN_WIDTH"
      :aria-valuemax="SIDEBAR_MAX_WIDTH"
      tabindex="0"
      @pointerdown="startResize"
      @keydown="resizeByKey"
    ></div>

    <main class="content" :inert="overlay || undefined">
      <p v-if="revoked" class="notice" role="status" data-testid="access-revoked">
        <strong>Zugriff entzogen.</strong> Du bist kein Mitglied dieses Workspace mehr. Was auf
        diesem Gerät liegt, bleibt lesbar und lässt sich
        <RouterLink :to="{ name: 'export', params: { workspaceId } }">exportieren</RouterLink>;
        ändern und synchronisieren geht nicht mehr.
        <RouterLink :to="{ name: 'members', params: { workspaceId } }"
          >Vom Gerät entfernen</RouterLink
        >
      </p>
      <p
        v-else-if="workspace?.local && readOnly"
        class="notice"
        role="status"
        data-testid="taken-over"
      >
        <strong>Schon in deinem Konto.</strong> Diese Seiten wurden beim Anmelden übernommen. Bis
        der Server alles bestätigt hat, bleiben sie hier als Sicherung zum Lesen und Exportieren.
      </p>
      <p v-else-if="workspace && readOnly" class="notice" role="status" data-testid="read-only">
        <strong>Nur lesen.</strong> Deine Rolle in diesem Workspace: {{ ROLE_LABELS[role] }}.
        Änderungen kann ein Besitzer freigeben.
      </p>
      <RouterView :key="String(route.params.documentId ?? route.params.tagId ?? '')" />
    </main>

    <CommandPalette
      v-if="paletteOpen"
      @close="paletteOpen = false"
      @new-page="createPage"
      @shortcuts="showShortcuts"
    />
    <ShortcutsDialog v-if="shortcutsOpen" @close="shortcutsOpen = false" />
  </div>
</template>
