<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { type Device, PASSWORD_MIN_LENGTH } from '@notion-alt/shared'
import { ApiError, api } from '../api'
import { deviceStatus } from '../device'
import { persistence, refreshWorkspaces, requireStore } from '../local/context'
import { formatBytes, type StorageUsage, storageUsage } from '../local/persistence'
import { connection, currentUser } from '../session'
import {
  disableNotifications,
  enableNotifications,
  notificationState,
  refreshNotificationState,
} from '../push-notifications'
import { resetAppCache } from '../pwa'
import { requestSync, syncState } from '../sync/engine'

const currentPassword = ref('')
const newPassword = ref('')
const repeatPassword = ref('')
const error = ref<string | null>(null)
const done = ref(false)
const busy = ref(false)

const messages: Record<string, string> = {
  invalid_current_password: 'Das aktuelle Passwort ist falsch.',
  invalid_input: `Das neue Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben.`,
  too_many_attempts: 'Zu viele Fehlversuche. Bitte später erneut versuchen.',
  unauthorized: 'Sitzung abgelaufen. Bitte erneut anmelden.',
}

// ------------------------------------------------------------------ devices

const devices = ref<Device[] | null>(null)
const deviceError = ref<string | null>(null)
const editing = ref<string | null>(null)
const editName = ref('')

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

async function loadDevices() {
  if (connection.value !== 'online') return
  try {
    devices.value = (await api.listDevices()).devices
  } catch {
    deviceError.value = 'Geräte konnten nicht geladen werden.'
  }
}

onMounted(loadDevices)

// ------------------------------------------------------------------ notifications

const notificationError = ref<string | null>(null)
const notificationBusy = ref(false)
onMounted(() => void refreshNotificationState())

async function toggleNotifications(enable: boolean) {
  notificationError.value = null
  notificationBusy.value = true
  try {
    await (enable ? enableNotifications() : disableNotifications())
  } catch (e) {
    console.error(e)
    notificationError.value = 'Benachrichtigungen konnten nicht geändert werden.'
  } finally {
    notificationBusy.value = false
  }
}

// ------------------------------------------------------------------ storage

const usage = ref<StorageUsage | null>(null)
onMounted(async () => {
  usage.value = await storageUsage()
})
// The device registers itself on the online refresh; show it once that happened.
watch(deviceStatus, loadDevices)

function startRename(device: Device) {
  editing.value = device.id
  editName.value = device.name
}

async function saveRename(device: Device) {
  deviceError.value = null
  try {
    await api.renameDevice(device.id, editName.value)
    editing.value = null
    await loadDevices()
  } catch {
    deviceError.value = 'Gerät konnte nicht umbenannt werden.'
  }
}

async function removeDevice(device: Device) {
  if (
    !window.confirm(
      `„${device.name}“ entfernen? Das Gerät wird abgemeldet und kann nicht mehr synchronisieren. ` +
        'Noch nicht synchronisierte Änderungen auf dem Gerät werden dann nicht übertragen.',
    )
  ) {
    return
  }
  deviceError.value = null
  try {
    await api.removeDevice(device.id)
    await loadDevices()
  } catch {
    deviceError.value = 'Gerät konnte nicht entfernt werden.'
  }
}

// ------------------------------------------------------------------ re-sync

const resyncing = ref(false)
const resyncDone = ref(false)

/** Loads every workspace again from a server snapshot; the unsynced queue is pushed first. */
async function resync() {
  resyncing.value = true
  resyncDone.value = false
  try {
    const store = requireStore()
    await refreshWorkspaces(store)
    await requestSync(store, { full: true })
    resyncDone.value = !syncState.value.lastError
  } finally {
    resyncing.value = false
  }
}

// ------------------------------------------------------------------ password

async function changePassword() {
  error.value = null
  done.value = false
  if (newPassword.value !== repeatPassword.value) {
    error.value = 'Die neuen Passwörter stimmen nicht überein.'
    return
  }
  busy.value = true
  try {
    await api.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    currentPassword.value = newPassword.value = repeatPassword.value = ''
    done.value = true
  } catch (e) {
    error.value =
      e instanceof ApiError ? (messages[e.code] ?? e.message) : 'Server nicht erreichbar.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="card">
    <header class="row">
      <h1>Konto</h1>
      <RouterLink :to="{ name: 'home' }">Zurück</RouterLink>
    </header>
    <p class="muted">Angemeldet als {{ currentUser?.email }}</p>

    <h2>Passwort ändern</h2>
    <p v-if="connection !== 'online'" class="muted" data-testid="password-offline">
      Zum Ändern des Passworts wird eine Serververbindung benötigt.
    </p>
    <form @submit.prevent="changePassword">
      <fieldset :disabled="connection !== 'online' || busy">
        <label>
          Aktuelles Passwort
          <input
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <label>
          Neues Passwort
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            :minlength="PASSWORD_MIN_LENGTH"
            required
          />
        </label>
        <label>
          Neues Passwort wiederholen
          <input
            v-model="repeatPassword"
            type="password"
            autocomplete="new-password"
            :minlength="PASSWORD_MIN_LENGTH"
            required
          />
        </label>
        <button type="submit">Passwort ändern</button>
      </fieldset>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="done" role="status">
      Passwort geändert. Andere Geräte müssen sich neu anmelden; ihre lokalen Daten bleiben
      erhalten.
    </p>

    <h2>Geräte</h2>
    <p v-if="deviceStatus === 'revoked'" class="error">
      Dieses Gerät wurde aus dem Konto entfernt. Lokale Daten bleiben erhalten, werden aber nicht
      mehr synchronisiert.
    </p>
    <p v-if="connection !== 'online'" class="muted">
      Die Geräteliste ist nur mit Serververbindung verfügbar.
    </p>
    <ul v-else-if="devices" class="devices" aria-label="Geräte">
      <li v-for="device in devices" :key="device.id" :data-testid="`device-${device.id}`">
        <form v-if="editing === device.id" class="row" @submit.prevent="saveRename(device)">
          <input v-model="editName" aria-label="Gerätename" maxlength="100" required />
          <button type="submit">Speichern</button>
          <button type="button" class="link" @click="editing = null">Abbrechen</button>
        </form>
        <template v-else>
          <span>
            <strong>{{ device.name }}</strong>
            <span v-if="device.current" class="muted"> (dieses Gerät)</span>
            <br />
            <small class="muted"
              >zuletzt gesehen {{ dateFormat.format(new Date(device.lastSeenAt)) }}</small
            >
          </span>
          <span class="row">
            <button type="button" class="link" @click="startRename(device)">Umbenennen</button>
            <button
              v-if="!device.current"
              type="button"
              class="link danger"
              @click="removeDevice(device)"
            >
              Entfernen
            </button>
          </span>
        </template>
      </li>
    </ul>
    <p v-if="deviceError" class="error" role="alert">{{ deviceError }}</p>

    <h2>Synchronisierung</h2>
    <p class="muted">
      Lädt alle Workspaces vollständig neu vom Server. Noch nicht synchronisierte Änderungen auf
      diesem Gerät werden zuerst gesendet und bleiben erhalten.
    </p>
    <button
      type="button"
      :disabled="connection !== 'online' || deviceStatus === 'revoked' || resyncing"
      @click="resync"
    >
      {{ resyncing ? 'Synchronisiert…' : 'Neu synchronisieren' }}
    </button>
    <p v-if="resyncDone" class="muted" data-testid="resync-done">Vollständig synchronisiert.</p>
    <p v-if="!resyncing && syncState.lastError" class="error">
      Synchronisierung fehlgeschlagen: {{ syncState.lastError }}
    </p>

    <h2>Benachrichtigungen</h2>
    <p class="muted">
      Ein Hinweis, wenn auf einem anderen Gerät etwas geändert wurde – ohne Inhalte. Die
      Synchronisierung läuft auch ohne Benachrichtigungen.
    </p>
    <p data-testid="notification-state">
      {{
        {
          unsupported: 'In diesem Browser bzw. über diese Adresse nicht verfügbar.',
          'needs-install':
            'Auf iPhone und iPad nur in der installierten App (Teilen → „Zum Home-Bildschirm“).',
          denied: 'Im Browser blockiert; in den Website-Einstellungen wieder erlauben.',
          off: 'Aus.',
          on: 'An für dieses Gerät.',
        }[notificationState]
      }}
    </p>
    <button
      v-if="notificationState === 'off'"
      type="button"
      :disabled="connection !== 'online' || notificationBusy"
      @click="toggleNotifications(true)"
    >
      Benachrichtigungen aktivieren
    </button>
    <button
      v-if="notificationState === 'on'"
      type="button"
      :disabled="notificationBusy"
      @click="toggleNotifications(false)"
    >
      Benachrichtigungen deaktivieren
    </button>
    <p v-if="notificationError" class="error" role="alert">{{ notificationError }}</p>

    <h2>Speicher auf diesem Gerät</h2>
    <p v-if="usage" data-testid="storage-usage">
      {{ formatBytes(usage.usage) }} von {{ formatBytes(usage.quota) }} belegt (lokale Daten und
      App-Dateien).
    </p>
    <p v-else class="muted">Der Browser nennt keinen Speicherverbrauch.</p>
    <p class="muted">
      {{
        persistence === 'persisted'
          ? 'Der Browser hat dauerhaften Speicher gewährt.'
          : 'Der Browser darf lokale Daten bei Speichermangel löschen; installieren hilft.'
      }}
    </p>

    <h2>App-Version</h2>
    <p class="muted">
      Hängt die App auf einer alten Version fest, entfernt dies die zwischengespeicherten
      App-Dateien und lädt sie neu vom Server. Lokale Daten bleiben erhalten.
    </p>
    <button type="button" :disabled="connection !== 'online'" @click="resetAppCache">
      App-Cache zurücksetzen
    </button>
  </main>
</template>

<style scoped>
h2 {
  margin: 1.5rem 0 0.75rem;
  font-size: 1.1rem;
}

.devices {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.devices > li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.danger {
  color: var(--error);
}

fieldset {
  display: grid;
  gap: 1rem;
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
