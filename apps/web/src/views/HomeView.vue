<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import {
  closeLocalStore,
  deleteLocalData,
  refreshWorkspaces,
  requireStore,
  workspaces,
} from '../local/context'
import { connection, currentUser, setCurrentUser } from '../session'
import { ROLE_LABELS } from '../sharing'
import { requestSync } from '../sync/engine'

const router = useRouter()
const newName = ref('')
const error = ref<string | null>(null)

onMounted(() => refreshWorkspaces(requireStore()))

async function createWorkspace() {
  error.value = null
  try {
    await api.createWorkspace({ name: newName.value })
    await refreshWorkspaces(requireStore())
    newName.value = ''
  } catch {
    error.value = 'Workspace konnte nicht angelegt werden. Ist der Server erreichbar?'
  }
}

// ------------------------------------------------------------------ sign out

const signingOut = ref(false)
const wipeLocal = ref(false)
const removeDevice = ref(false)
const discardUnsynced = ref(false)
const unsynced = ref(0)
const syncing = ref(false)

async function countUnsynced() {
  unsynced.value = await requireStore().pendingOperationCount()
}

async function startLogout() {
  error.value = null
  wipeLocal.value = removeDevice.value = discardUnsynced.value = false
  await countUnsynced()
  signingOut.value = true
}

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
  setCurrentUser(null)
  await router.push({ name: 'login' })
}
</script>

<template>
  <main class="card">
    <header class="row">
      <h1>Workspaces</h1>
      <span class="row">
        <RouterLink :to="{ name: 'account' }">Konto</RouterLink>
        <button type="button" class="link" @click="startLogout">Abmelden</button>
      </span>
    </header>
    <p class="muted">Angemeldet als {{ currentUser?.email }}</p>
    <ul class="list">
      <li v-for="workspace in workspaces" :key="workspace.id">
        <RouterLink :to="{ name: 'workspace', params: { workspaceId: workspace.id } }">
          {{ workspace.name }}
        </RouterLink>
        <small v-if="workspace.revoked" class="muted" data-testid="workspace-revoked">
          Zugriff entzogen
        </small>
        <small
          v-else-if="workspace.role && workspace.ownerId !== currentUser?.id"
          class="muted"
          data-testid="workspace-shared"
        >
          geteilt · {{ ROLE_LABELS[workspace.role] }}
        </small>
      </li>
    </ul>
    <p v-if="workspaces.length === 0" class="muted">
      Keine Workspaces auf diesem Gerät. Beim ersten Start wird eine Serververbindung benötigt.
    </p>
    <form class="row" @submit.prevent="createWorkspace">
      <input v-model="newName" placeholder="Neuer Workspace" maxlength="100" required />
      <button type="submit" :disabled="connection !== 'online'">Anlegen</button>
    </form>
    <section v-if="signingOut" class="logout" aria-labelledby="logout-title">
      <h2 id="logout-title">Abmelden</h2>
      <p class="muted">
        Lokale Daten bleiben auf diesem Gerät und sind nach dem nächsten Anmelden wieder da.
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
        <button type="button" :disabled="connection !== 'online' || syncing" @click="syncFirst">
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
      <div class="row">
        <button type="button" class="link" @click="signingOut = false">Abbrechen</button>
        <button type="button" @click="logout">
          {{ wipeLocal ? 'Abmelden und lokale Daten löschen' : 'Abmelden' }}
        </button>
      </div>
    </section>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>

<style scoped>
.logout {
  display: grid;
  gap: var(--space-md);
  margin-top: var(--space-xl);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border);
}

.logout h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.check {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
}
</style>
