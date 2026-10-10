<script setup lang="ts">
import type { SharedPage } from '@notion-alt/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError, api } from '../api'
import { renderInline } from '../editor/inline-dom'

/**
 * A page shared by read link (ADR 0022), for guests without an account: online only, read only,
 * no local database, no session. Page links show as plain text.
 */
const route = useRoute()
const token = String(route.params.token)

type Block = SharedPage['blocks'][number] & { key: number }

const page = ref<SharedPage['page'] | null>(null)
const blocks = ref<Block[]>([])
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const collapsed = ref(new Set<number>())

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const imageUrl = (id: string) =>
  `/api/public/shares/${encodeURIComponent(token)}/attachments/${encodeURIComponent(id)}`

const renderOptions = {
  resolvePage: () => undefined,
  pageHref: () => '#',
  plainPageLinks: true,
}

// Search engines must not list shared pages; the API answers carry X-Robots-Tag as well.
const robots = document.createElement('meta')
robots.name = 'robots'
robots.content = 'noindex, nofollow'

onMounted(async () => {
  document.head.append(robots)
  try {
    const shared = await api.sharedPage(token)
    page.value = shared.page
    blocks.value = shared.blocks.map((block, key) => ({ ...block, key }))
    document.title = shared.page.title || 'Unbenannt'
    state.value = 'ready'
  } catch (error) {
    state.value = error instanceof ApiError && error.status === 404 ? 'missing' : 'error'
  }
})

onUnmounted(() => robots.remove())

/** Numbers of ordered list items, counted per indentation level like in the editor. */
const listNumbers = computed(() => {
  const numbers = new Map<number, number>()
  const counters: number[] = []
  for (const block of blocks.value) {
    if (block.type !== 'list_item') {
      counters.length = 0
      continue
    }
    const indent = block.attrs.indent ?? 0
    counters.length = indent + 1
    if (block.attrs.list === 'ordered') {
      counters[indent] = (counters[indent] ?? 0) + 1
      numbers.set(block.key, counters[indent]!)
    } else {
      counters[indent] = 0
    }
  }
  return numbers
})

/** Children of collapsed toggles: the following blocks with a larger indent (ADR 0019). */
const hidden = computed(() => {
  const result = new Set<number>()
  let hideAbove: number | null = null
  for (const block of blocks.value) {
    const indent = block.attrs.indent ?? 0
    if (hideAbove !== null && indent > hideAbove) {
      result.add(block.key)
      continue
    }
    hideAbove = block.type === 'toggle' && collapsed.value.has(block.key) ? indent : null
  }
  return result
})

function toggle(key: number) {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}

function blockClass(block: Block) {
  return [
    `block-${block.type.replace('_', '-')}`,
    block.type === 'heading' ? `level-${block.attrs.level ?? 1}` : null,
    block.type === 'list_item' ? `list-${block.attrs.list ?? 'bullet'}` : null,
    block.type === 'todo' && block.attrs.checked ? 'checked' : null,
  ]
}

/** Renders Markdown inline without innerHTML (same renderer as the editor). */
const inline = (content: string) => (el: unknown) => {
  if (el instanceof HTMLElement) renderInline(el, content, renderOptions)
}

const cover = computed(() => {
  const value = page.value?.cover
  if (!value) return null
  if (value.startsWith('gradient:')) return { gradient: value.slice('gradient:'.length) }
  return { image: imageUrl(value.slice('attachment:'.length)) }
})
</script>

<template>
  <main class="shared-page">
    <p v-if="state === 'loading'" class="muted">Lädt …</p>
    <section v-else-if="state === 'missing'" class="shared-message" data-testid="share-missing">
      <h1>Link nicht verfügbar</h1>
      <p class="muted">
        Dieser Link ist ungültig, abgelaufen oder wurde widerrufen. Frag die Person, die ihn dir
        geschickt hat, nach einem neuen Link.
      </p>
    </section>
    <section v-else-if="state === 'error'" class="shared-message" role="alert">
      <h1>Seite konnte nicht geladen werden</h1>
      <p class="muted">Der Server ist gerade nicht erreichbar. Versuche es später noch einmal.</p>
    </section>
    <article v-else-if="page" class="page" data-testid="shared-page">
      <div
        v-if="cover"
        class="page-cover"
        :class="cover.gradient ? `cover-${cover.gradient}` : 'cover-image'"
      >
        <img v-if="cover.image" :src="cover.image" alt="" />
      </div>
      <p class="shared-notice muted">
        Schreibgeschützte Ansicht · zuletzt geändert
        {{ dateFormat.format(new Date(page.updatedAt)) }}
      </p>
      <p v-if="page.icon" class="page-icon shared-icon" aria-hidden="true">{{ page.icon }}</p>
      <h1 class="page-title">{{ page.title || 'Unbenannt' }}</h1>
      <div class="editor shared-blocks">
        <div
          v-for="block in blocks"
          :key="block.key"
          class="block"
          :class="blockClass(block)"
          :style="{ '--indent': block.attrs.indent ?? 0 }"
          :hidden="hidden.has(block.key)"
        >
          <span v-if="block.type === 'list_item'" class="list-marker" aria-hidden="true">{{
            block.attrs.list === 'ordered' ? `${listNumbers.get(block.key)}.` : '•'
          }}</span>
          <input
            v-if="block.type === 'todo'"
            type="checkbox"
            class="todo-check"
            :checked="!!block.attrs.checked"
            disabled
            aria-label="Erledigt"
          />
          <button
            v-else-if="block.type === 'toggle'"
            type="button"
            class="icon toggle-arrow"
            :aria-expanded="!collapsed.has(block.key)"
            :aria-label="collapsed.has(block.key) ? 'Aufklappen' : 'Zuklappen'"
            @click="toggle(block.key)"
          >
            {{ collapsed.has(block.key) ? '▸' : '▾' }}
          </button>
          <span v-else-if="block.type === 'callout'" class="icon callout-icon" aria-hidden="true">
            {{ block.attrs.icon ?? '💡' }}
          </span>
          <hr v-if="block.type === 'divider'" class="divider" />
          <figure v-else-if="block.type === 'image'" class="shared-image">
            <img
              v-if="block.attrs.attachmentId"
              :src="imageUrl(block.attrs.attachmentId)"
              :alt="block.content"
              loading="lazy"
            />
            <figcaption v-if="block.content" class="muted">{{ block.content }}</figcaption>
          </figure>
          <p v-else-if="block.type === 'file'" class="shared-file muted">
            📎 {{ block.content || 'Datei' }} (nur für Mitglieder abrufbar)
          </p>
          <pre v-else-if="block.type === 'code'" class="block-input code-input">{{
            block.content
          }}</pre>
          <div v-else :ref="inline(block.content)" class="block-input"></div>
        </div>
      </div>
    </article>
  </main>
</template>

<style scoped>
.shared-page {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: var(--space-xl) var(--space-lg);
}

.shared-message {
  margin-top: var(--space-xl);
}

.shared-notice {
  margin: var(--space-md) 0 0;
  font-size: var(--text-sm);
}

.shared-icon {
  margin: var(--space-lg) 0 0;
}

.shared-image {
  margin: 0;
}

.shared-image img {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-md);
}

.shared-file {
  margin: 0;
}

.shared-blocks .code-input {
  margin: 0;
  white-space: pre-wrap;
}
</style>
