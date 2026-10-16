<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { closeLocalStore, deleteLocalData, requireStore } from '../local/context'
import { connection, currentUser, signedOut } from '../session'
import { requestSync } from '../sync/engine'

/**
 * Sign out with its options (#74, #196): local data stays by default; deleting it on a shared
 * device and removing the device from the account are explicit choices.
 */
const emit = defineEmits<{ close: [] }>()
const router = useRouter()

const wipeLocal = ref(false)
const removeDevice = ref(false)
const discardUnsynced = ref(false)
const unsynced = ref(0)
const syncing = ref(false)
const error = ref<string | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)

async function countUnsynced() {
  unsynced.value = await requireStore().pendingOperationCount()
}

onMounted(async () => {
  cancelButton.value?.focus()
  await countUnsynced()
})

async function syncFirst() {
  syncing.value = true
  try {
    await requestSync(requireStore())
    await countUnsynced()
  } finally {
    syncing.value = false
  }
}

async function logout() {
  error.value = null
  if (wipeLocal.value) await countUnsynced()
  if (wipeLocal.value && unsynced.value > 0 && !discardUnsynced.value) {
    error.value = 'Bitte bestätigen, dass die nicht synchronisierten Änderungen verloren gehen.'
    return
  }
  const userId = currentUser.value?.id
  try {
    await api.logout({ removeDevice: removeDevice.value })
  } catch {
    // On a shared device the local copy must be removable without the server (#74). The
    // server session stays valid until it expires, so say how to end it.
    const wipeAnyway =
      wipeLocal.value &&
      window.confirm(
        'Der Server ist nicht erreichbar. Lokale Daten trotzdem löschen?\n\n' +
          'Die Anmeldung bleibt im Browser gespeichert, bis sie abläuft: Danach in den ' +
          'Browser-Einstellungen die Website-Daten (Cookies) dieser Seite löschen oder sich ' +
          'später online erneut abmelden.',
      )
    if (!wipeAnyway) {
      error.value = 'Abmelden fehlgeschlagen. Ist der Server erreichbar?'
      return
    }
  }
  // By default local data stays on the device (local-first, ADR 0009); only the cached sign-in
  // is removed. Deleting it is an explicit choice for shared devices.
  if (wipeLocal.value && userId) await deleteLocalData(userId)
  else closeLocalStore()
  signedOut()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="palette-backdrop" @pointerdown.self="emit('close')" @keydown.escape="emit('close')">
    <section
      class="palette dialog logout"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-title"
    >
      <h2 id="logout-title">Abmelden</h2>
      <p class="muted">
        Lokale Daten bleiben auf diesem Gerät und sind nach dem nächsten Anmelden wieder da.
      </p>
      <p v-if="connection !== 'online'" class="muted" data-testid="logout-offline">
        Der Server ist gerade nicht erreichbar. Lokale Daten lassen sich trotzdem löschen; die
        Anmeldung endet dann erst, wenn sie abläuft.
      </p>
      <label class="check">
        <input v-model="wipeLocal" type="checkbox" />
        Lokale Daten auf diesem Gerät löschen (z. B. an einem gemeinsam genutzten Computer)
      </label>
      <template v-if="wipeLocal && unsynced > 0">
        <p class="error" data-testid="unsynced-warning">
          {{ unsynced }} Änderung{{ unsynced === 1 ? '' : 'en' }} auf diesem Gerät
          {{ unsynced === 1 ? 'ist' : 'sind' }} noch nicht synchronisiert und
          {{ unsynced === 1 ? 'ginge' : 'gingen' }} beim Löschen verloren.
        </p>
        <button
          type="button"
          class="secondary"
          :disabled="connection !== 'online' || syncing"
          @click="syncFirst"
        >
          {{ syncing ? 'Synchronisiert…' : 'Erst synchronisieren' }}
        </button>
        <label class="check">
          <input v-model="discardUnsynced" type="checkbox" />
          Nicht synchronisierte Änderungen verwerfen
        </label>
      </template>
      <label class="check">
        <input v-model="removeDevice" type="checkbox" />
        Dieses Gerät auch aus dem Konto entfernen
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="row dialog-actions">
        <button ref="cancelButton" type="button" class="link" @click="emit('close')">
          Abbrechen
        </button>
        <button type="button" @click="logout">
          {{ wipeLocal ? 'Abmelden und lokale Daten löschen' : 'Abmelden' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.logout {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-xl);
  overflow-y: auto;
}

.logout h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.logout p {
  margin: 0;
}

.check {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
}

.dialog-actions {
  justify-content: flex-end;
}
</style>
