<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { persistence, requestPersistence } from '../local/context'
import { connection, currentUser } from '../session'
import { syncState } from '../sync/engine'
import { formatTime } from '../format'

/**
 * One status line at the bottom of the sidebar (#195): a dot and a short text. Details and
 * "Jetzt synchronisieren" are in a small popover; the test ids of the details stay in the DOM.
 */
const props = defineProps<{
  /** Operations not on the server yet. */
  pending: number
  /** Operations among them that wait for a decision (rejected, conflict). */
  withIssues: number
}>()
const emit = defineEmits<{ sync: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)

const waiting = computed(() => Math.max(0, props.pending - props.withIssues))
const changes = (n: number) => `${n} Änderung${n === 1 ? '' : 'en'} warte${n === 1 ? 't' : 'n'}`

/** Short state: green when everything is on the server, amber when something waits. */
const tone = computed(() => {
  if (connection.value === 'local') return 'local'
  if (connection.value !== 'online') return 'offline'
  if (syncState.value.lastError || waiting.value > 0) return 'waiting'
  return 'online'
})

const summary = computed(() => {
  switch (connection.value) {
    case 'local':
      return 'Nur auf diesem Gerät'
    case 'expired':
      return 'Sitzung abgelaufen'
    case 'offline':
      return waiting.value ? `Offline · ${changes(waiting.value)}` : 'Offline'
  }
  const resync = syncState.value.resync
  if (resync) {
    const percent = resync.total ? Math.floor((resync.done / resync.total) * 100) : 0
    return `Neu synchronisieren… ${percent} %`
  }
  if (syncState.value.running) return 'Synchronisiert…'
  if (syncState.value.lastError) return 'Synchronisierung fehlgeschlagen'
  if (waiting.value) return changes(waiting.value)
  return syncState.value.lastSyncAt ? 'Synchronisiert' : 'Noch nicht synchronisiert'
})

/** Detail line telling whether local data is on the server. */
const syncLabel = computed(() => {
  if (connection.value !== 'online') return null
  const resync = syncState.value.resync
  if (resync) {
    const percent = resync.total ? Math.floor((resync.done / resync.total) * 100) : 0
    return `Neu synchronisieren… ${percent} %`
  }
  if (syncState.value.running) return 'Synchronisiert…'
  if (syncState.value.lastError) return 'Synchronisierung fehlgeschlagen – neuer Versuch folgt'
  if (waiting.value) return 'Änderungen ausstehend'
  const at = syncState.value.lastSyncAt
  return at ? `Synchronisiert um ${formatTime(at)}` : 'Noch nicht synchronisiert'
})

const connectionLabel = computed(
  () =>
    ({
      online: 'Server verbunden',
      offline: 'Offline – lokale Daten',
      expired: 'Sitzung abgelaufen',
      local: 'Nur auf diesem Gerät',
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

function close(returnFocus = true) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function closeOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close(false)
}
watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('pointerdown', closeOutside)
  else window.removeEventListener('pointerdown', closeOutside)
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOutside))
</script>

<template>
  <div ref="root" class="sync-status-root" @keydown.escape="open && close()">
    <p class="status-line">
      <button
        ref="trigger"
        type="button"
        class="status-summary"
        :class="`tone-${tone}`"
        :aria-expanded="open"
        aria-controls="sync-details"
        data-testid="sync-summary"
        @click="open = !open"
      >
        <span class="dot" aria-hidden="true"></span>{{ summary }}
      </button>
      <RouterLink
        v-if="connection === 'expired' || connection === 'local'"
        :to="{ name: 'login' }"
        data-testid="sign-in"
        >Anmelden</RouterLink
      >
    </p>
    <div
      v-show="open"
      id="sync-details"
      class="block-menu sync-details"
      role="group"
      aria-label="Status"
    >
      <p class="status" :class="`status-${connection}`" data-testid="connection">
        <span class="dot" aria-hidden="true"></span>{{ connectionLabel }}
      </p>
      <p v-if="currentUser && connection !== 'local'" class="muted">{{ currentUser.email }}</p>
      <p v-if="connection !== 'local'" class="muted" data-testid="pending">
        {{ pending }} lokale Änderung{{ pending === 1 ? '' : 'en' }} noch nicht synchronisiert
      </p>
      <p v-if="syncLabel" class="muted" data-testid="sync-status">{{ syncLabel }}</p>
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
      <p v-if="connection === 'local'" class="muted">
        Ohne Konto bleiben die Seiten auf diesem Gerät. Mit einem Konto werden sie zwischen deinen
        Geräten synchronisiert.
      </p>
      <button
        v-if="connection !== 'local'"
        type="button"
        class="secondary"
        :disabled="syncState.running"
        @click="emit('sync')"
      >
        Jetzt synchronisieren
      </button>
    </div>
  </div>
</template>
