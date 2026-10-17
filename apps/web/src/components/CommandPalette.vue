<script setup lang="ts">
import type { ServerSearchHit } from '@notion-alt/shared'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { recentPages } from '../composables/recent-pages'
import { pageLabel, useWorkspace } from '../composables/workspace'
import { workspaceSearch } from '../local/context'
import type { SearchHit } from '../local/search'
import { connection } from '../session'
import { requestSync } from '../sync/engine'
import { toggleTheme } from '../theme'

/**
 * Quick search and commands (#134), opened with Ctrl/⌘+K or Ctrl/⌘+P. Searches the local index
 * (MiniSearch), so it works offline like the rest of the app. Online it adds the server's hits
 * for pages whose content is not on this device yet (ADR 0017, #219), like the sidebar search.
 */
const emit = defineEmits<{ close: []; newPage: []; shortcuts: [] }>()

const { store, workspaceId, documentsById } = useWorkspace()
const router = useRouter()

interface Item {
  key: string
  label: string
  hint?: string
  run: () => void | Promise<unknown>
}

const query = ref('')
const hits = ref<SearchHit[]>([])
const serverHits = ref<ServerSearchHit[]>([])
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

const actions: Item[] = [
  { key: 'action:new', label: 'Neue Seite', hint: 'Befehl', run: () => emit('newPage') },
  {
    key: 'action:account',
    label: 'Einstellungen',
    hint: 'Befehl',
    run: () => router.push({ name: 'account' }),
  },
  {
    key: 'action:theme',
    label: 'Hell/Dunkel umschalten',
    hint: 'Befehl',
    run: () => toggleTheme(),
  },
  {
    key: 'action:trash',
    label: 'Papierkorb',
    hint: 'Befehl',
    run: () => router.push({ name: 'trash', params: { workspaceId: workspaceId.value } }),
  },
  {
    key: 'action:export',
    label: 'Export & Import',
    hint: 'Befehl',
    run: () => router.push({ name: 'export', params: { workspaceId: workspaceId.value } }),
  },
  { key: 'action:shortcuts', label: 'Tastenkürzel', hint: 'Befehl', run: () => emit('shortcuts') },
]

const openPage = (id: string) =>
  router.push({ name: 'page', params: { workspaceId: workspaceId.value, documentId: id } })

async function openServerHit(id: string) {
  // Not on this device yet: fetch it first.
  if (!documentsById.value.has(id)) await requestSync(store)
  await openPage(id)
}

const items = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) {
    const recent = recentPages.value
      .map((id) => documentsById.value.get(id))
      .filter((d) => d !== undefined)
      .map((d) => ({
        key: `page:${d.id}`,
        label: pageLabel(d),
        hint: 'Zuletzt besucht',
        run: () => openPage(d.id),
      }))
    return [...recent, ...actions]
  }
  const pages = hits.value.map((hit) => ({
    key: `page:${hit.id}`,
    label: documentsById.value.has(hit.id)
      ? pageLabel(documentsById.value.get(hit.id))
      : hit.title || 'Unbenannt',
    hint: hit.snippet,
    run: () => openPage(hit.id),
  }))
  const local = new Set(hits.value.map((hit) => hit.id))
  const fromServer = serverHits.value
    .filter((hit) => !local.has(hit.documentId))
    .map((hit) => ({
      key: `server:${hit.documentId}`,
      label: documentsById.value.has(hit.documentId)
        ? pageLabel(documentsById.value.get(hit.documentId))
        : hit.title || 'Unbenannt',
      hint: hit.snippet ? `Vom Server · ${hit.snippet}` : 'Vom Server',
      run: () => openServerHit(hit.documentId),
    }))
  return [...pages, ...fromServer, ...actions.filter((a) => a.label.toLowerCase().includes(q))]
})

let searchRun = 0
watch(query, async (value) => {
  active.value = 0
  const run = ++searchRun
  if (!value.trim()) {
    hits.value = []
    return
  }
  const search = await workspaceSearch(store, workspaceId.value)
  await search.flush()
  if (run === searchRun) hits.value = search.index.search(value, 10)
})
let serverTimer: ReturnType<typeof setTimeout> | null = null
watch(query, (value) => {
  if (serverTimer) clearTimeout(serverTimer)
  serverHits.value = []
  const q = value.trim()
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
onUnmounted(() => {
  if (serverTimer) clearTimeout(serverTimer)
})

watch(items, () => {
  if (active.value >= items.value.length) active.value = Math.max(0, items.value.length - 1)
})

async function choose(item: Item | undefined) {
  if (!item) return
  emit('close')
  await item.run()
}

function onKeydown(event: KeyboardEvent) {
  const count = items.value.length
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (count) active.value = (active.value + 1) % count
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (count) active.value = (active.value - 1 + count) % count
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void choose(items.value[active.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

watch(active, async () => {
  await nextTick()
  document.querySelector('.palette [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
})

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="palette-backdrop" @pointerdown.self="emit('close')">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Schnellsuche">
      <input
        ref="input"
        v-model="query"
        type="search"
        placeholder="Seiten suchen oder Befehl eingeben…"
        aria-label="Schnellsuche"
        role="combobox"
        aria-controls="palette-list"
        aria-expanded="true"
        :aria-activedescendant="items[active] ? `palette-${active}` : undefined"
        @keydown="onKeydown"
      />
      <ul id="palette-list" role="listbox" aria-label="Ergebnisse">
        <li
          v-for="(item, index) in items"
          :id="`palette-${index}`"
          :key="item.key"
          role="option"
          :aria-selected="index === active"
          @pointermove="active = index"
          @click="choose(item)"
        >
          <span>{{ item.label }}</span>
          <small v-if="item.hint" class="muted">{{ item.hint }}</small>
        </li>
        <li v-if="items.length === 0" class="muted empty" role="presentation">Keine Treffer</li>
      </ul>
    </div>
  </div>
</template>
