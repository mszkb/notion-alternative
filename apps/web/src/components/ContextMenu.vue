<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

/**
 * The app's own context menu (#191) for text, blocks, links and the page tree, at the pointer or
 * at the focused element (Shift+F10, context menu key). Entries keep the focus where it was on
 * pointer down, so a text selection survives until the entry runs. Arrow keys move, Enter runs,
 * Esc closes.
 */
export interface ContextMenuItem {
  label: string
  run: () => unknown
  danger?: boolean
  /** A separator line before this entry. */
  separated?: boolean
}

const props = defineProps<{ x: number; y: number; items: ContextMenuItem[] }>()
const emit = defineEmits<{ close: [] }>()

const menu = ref<HTMLElement | null>(null)
const position = ref({ left: props.x, top: props.y })

function close() {
  emit('close')
}

async function choose(item: ContextMenuItem) {
  close()
  await item.run()
}

function entries(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
}

function onKeydown(event: KeyboardEvent) {
  const items = entries()
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    close()
  }
}

function onOutside(event: Event) {
  if (!menu.value?.contains(event.target as Node)) close()
}

onMounted(async () => {
  await nextTick()
  // Inside the window, also near the right and bottom edge.
  const box = menu.value?.getBoundingClientRect()
  if (box) {
    position.value = {
      left: Math.max(4, Math.min(props.x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(props.y, window.innerHeight - box.height - 4)),
    }
  }
  entries()[0]?.focus({ preventScroll: true })
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <!-- In body: a transformed ancestor (sidebar overlay) would move a fixed menu. -->
  <Teleport to="body">
    <ul
      ref="menu"
      class="block-menu context-menu"
      role="menu"
      aria-label="Kontextmenü"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @keydown="onKeydown"
      @contextmenu.prevent
    >
      <template v-for="item in items" :key="item.label">
        <li v-if="item.separated" class="separator" role="separator"></li>
        <li>
          <button
            type="button"
            role="menuitem"
            :class="{ danger: item.danger }"
            @pointerdown.prevent
            @click="choose(item)"
          >
            {{ item.label }}
          </button>
        </li>
      </template>
    </ul>
  </Teleport>
</template>
