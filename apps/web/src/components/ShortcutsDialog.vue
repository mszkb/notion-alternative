<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { SHORTCUT_OVERVIEW } from '../shortcuts'

/** Overview of the keyboard shortcuts (#134), Ctrl/⌘ + /. */
const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement | null>(null)
onMounted(() => closeButton.value?.focus())
</script>

<template>
  <div class="palette-backdrop" @pointerdown.self="emit('close')" @keydown.escape="emit('close')">
    <div
      class="palette shortcuts"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <header class="row">
        <h2 id="shortcuts-title">Tastenkürzel</h2>
        <button
          ref="closeButton"
          type="button"
          class="icon"
          aria-label="Schließen"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <table>
        <tbody>
          <tr v-for="entry in SHORTCUT_OVERVIEW" :key="entry.keys">
            <td>
              <kbd>{{ entry.keys }}</kbd>
            </td>
            <td>{{ entry.action }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">
        Markdown beim Tippen: <kbd>#</kbd> Überschrift, <kbd>-</kbd> Liste,
        <kbd>1.</kbd> nummeriert, <kbd>[]</kbd> To-do, <kbd>&gt;</kbd> Zitat, <kbd>```</kbd> Code,
        <kbd>---</kbd> Trenner, <kbd>[[</kbd> Seitenlink, <kbd>/</kbd> alle Blocktypen.
      </p>
    </div>
  </div>
</template>
