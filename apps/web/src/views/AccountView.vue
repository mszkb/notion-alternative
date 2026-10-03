<script setup lang="ts">
import { ref } from 'vue'
import { PASSWORD_MIN_LENGTH } from '@notion-alt/shared'
import { ApiError, api } from '../api'
import { connection, currentUser } from '../session'

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
  </main>
</template>

<style scoped>
h2 {
  margin: 1.5rem 0 0.75rem;
  font-size: 1.1rem;
}

fieldset {
  display: grid;
  gap: 1rem;
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
