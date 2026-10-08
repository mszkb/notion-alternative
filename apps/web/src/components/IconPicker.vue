<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * Emoji choice for a page icon (#136), without any external service: a fixed selection plus a
 * field for any other emoji (the system's emoji keyboard works there too).
 */
const emit = defineEmits<{ select: [icon: string | null]; close: [] }>()

const EMOJIS = [
  '📄',
  '📝',
  '📌',
  '📎',
  '📁',
  '📂',
  '🗂️',
  '📚',
  '📖',
  '📓',
  '📒',
  '🗒️',
  '✅',
  '☑️',
  '⭐',
  '💡',
  '🔥',
  '⚡',
  '🎯',
  '🚀',
  '🏁',
  '🔖',
  '🏷️',
  '🔑',
  '🏠',
  '🏢',
  '🧳',
  '✈️',
  '🚗',
  '🚲',
  '🗺️',
  '🌍',
  '🏖️',
  '⛰️',
  '🌱',
  '🌳',
  '💼',
  '💰',
  '🧾',
  '📊',
  '📈',
  '🗓️',
  '⏰',
  '☎️',
  '💻',
  '🖥️',
  '⚙️',
  '🛠️',
  '🍽️',
  '🍳',
  '☕',
  '🍎',
  '🎵',
  '🎨',
  '📷',
  '🎬',
  '⚽',
  '🏃',
  '🧘',
  '❤️',
  '👪',
  '👶',
  '🐶',
  '🐱',
  '🎁',
  '🎉',
  '🧠',
  '🔬',
  '💊',
  '🏥',
  '📣',
  '❓',
]

const custom = ref('')
const root = ref<HTMLElement | null>(null)

function useCustom() {
  const value = [...custom.value.trim()].slice(0, 4).join('')
  if (value) emit('select', value)
}

onMounted(() => root.value?.querySelector<HTMLElement>('button')?.focus())
</script>

<template>
  <div
    ref="root"
    class="block-menu icon-picker"
    role="dialog"
    aria-label="Icon wählen"
    @keydown.escape="emit('close')"
  >
    <div class="emoji-grid">
      <button
        v-for="emoji in EMOJIS"
        :key="emoji"
        type="button"
        class="icon"
        :aria-label="`Icon ${emoji}`"
        @click="emit('select', emoji)"
      >
        {{ emoji }}
      </button>
    </div>
    <form class="row" @submit.prevent="useCustom">
      <input
        v-model="custom"
        maxlength="16"
        placeholder="Anderes Emoji"
        aria-label="Anderes Emoji"
      />
      <button type="submit" class="secondary">Übernehmen</button>
    </form>
    <button type="button" class="secondary danger" @click="emit('select', null)">Entfernen</button>
  </div>
</template>
