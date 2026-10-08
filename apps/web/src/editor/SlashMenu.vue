<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { filterSlashOptions, type SlashOption } from './slash'

/**
 * Menu opened by typing "/" (#133): inserts or turns into a block type, filtered by what is typed.
 * Keyboard only: arrows, Enter, Esc.
 */
defineProps<{ position: { top: number; left: number } }>()
const emit = defineEmits<{ select: [option: SlashOption]; close: []; dismiss: [] }>()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const options = computed(() => filterSlashOptions(query.value))

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
    if (option) emit('select', option)
    else emit('close')
  } else if (event.key === 'Escape' || (event.key === 'Backspace' && !query.value)) {
    event.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div
    class="picker"
    role="dialog"
    aria-label="Block einfügen"
    :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    @mousedown.stop
  >
    <input
      ref="input"
      v-model="query"
      placeholder="Blocktyp suchen…"
      aria-label="Blocktyp"
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
        @mousedown.prevent="emit('select', option)"
      >
        <span>{{ option.label }}</span>
        <small class="muted">{{ option.hint }}</small>
      </li>
      <li v-if="options.length === 0" class="muted empty">Kein Blocktyp gefunden</li>
    </ul>
  </div>
</template>
