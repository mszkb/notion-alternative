<script setup lang="ts">
import { isSafeHref } from '@notion-alt/shared'
import { computed, nextTick, onMounted, ref } from 'vue'
import { displayTitle, useWorkspace } from '../composables/workspace'

export type PickerChoice =
  | { kind: 'page'; documentId: string; title: string }
  | { kind: 'new-page'; title: string }
  | { kind: 'url'; href: string }

const props = defineProps<{
  mode: 'page' | 'link'
  position: { top: number; left: number }
  excludeId?: string
}>()
const emit = defineEmits<{ select: [choice: PickerChoice]; close: []; dismiss: [] }>()

const { documents } = useWorkspace()
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

function asUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  return isSafeHref(candidate) && (candidate.includes('.') || candidate.startsWith('mailto:'))
    ? candidate
    : null
}

interface Option {
  key: string
  label: string
  hint?: string
  choice: PickerChoice
}

const options = computed<Option[]>(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const result: Option[] = []
  const url = props.mode === 'link' ? asUrl(query.value) : null
  if (url)
    result.push({
      key: 'url',
      label: url,
      hint: 'Externer Link',
      choice: { kind: 'url', href: url },
    })
  const pages = documents.value
    .filter((d) => d.id !== props.excludeId)
    .filter((d) => !needle || displayTitle(d).toLocaleLowerCase().includes(needle))
    .slice(0, 8)
  for (const page of pages) {
    result.push({
      key: page.id,
      label: displayTitle(page),
      hint: 'Seite',
      choice: { kind: 'page', documentId: page.id, title: displayTitle(page) },
    })
  }
  if (props.mode === 'page' && query.value.trim()) {
    result.push({
      key: 'new',
      label: `„${query.value.trim()}“`,
      hint: 'Neue Unterseite',
      choice: { kind: 'new-page', title: query.value.trim() },
    })
  }
  return result
})

onMounted(async () => {
  await nextTick()
  input.value?.focus()
})

function onKeydown(event: KeyboardEvent) {
  const count = options.value.length
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = count ? (active.value + 1) % count : 0
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = count ? (active.value - 1 + count) % count : 0
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = options.value[Math.min(active.value, count - 1)]
    if (option) emit('select', option.choice)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div
    class="picker"
    role="dialog"
    :aria-label="mode === 'page' ? 'Seite verlinken' : 'Link einfügen'"
    :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    @mousedown.stop
  >
    <input
      ref="input"
      v-model="query"
      :placeholder="mode === 'page' ? 'Seite suchen…' : 'URL oder Seite…'"
      aria-label="Linkziel"
      @input="active = 0"
      @keydown="onKeydown"
      @blur="emit('dismiss')"
    />
    <ul role="listbox">
      <li
        v-for="(option, index) in options"
        :key="option.key"
        role="option"
        :aria-selected="index === active"
        :class="{ active: index === active }"
        @mousedown.prevent="emit('select', option.choice)"
      >
        <span>{{ option.label }}</span>
        <small class="muted">{{ option.hint }}</small>
      </li>
      <li v-if="options.length === 0" class="muted empty">Keine Seite gefunden</li>
    </ul>
  </div>
</template>
