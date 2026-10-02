<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PASSWORD_MIN_LENGTH } from '@notion-alt/shared'
import { ApiError, api } from '../api'
import { setCurrentUser } from '../session'

const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const registrationOpen = ref(false)
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

onMounted(async () => {
  registrationOpen.value = (await api.authStatus()).registrationOpen
})

const messages: Record<string, string> = {
  invalid_credentials: 'E-Mail oder Passwort ist falsch.',
  registration_closed: 'Die Registrierung ist geschlossen.',
  email_taken: 'Diese E-Mail-Adresse ist bereits registriert.',
  invalid_input: `Bitte eine gültige E-Mail und ein Passwort mit mindestens ${PASSWORD_MIN_LENGTH} Zeichen angeben.`,
}

async function submit() {
  error.value = null
  busy.value = true
  try {
    const input = { email: email.value, password: password.value }
    const { user } = mode.value === 'login' ? await api.login(input) : await api.register(input)
    setCurrentUser(user)
    await router.push({ name: 'home' })
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
    <h1>{{ mode === 'login' ? 'Anmelden' : 'Konto erstellen' }}</h1>
    <form @submit.prevent="submit">
      <label>
        E-Mail
        <input v-model="email" type="email" autocomplete="email" required />
      </label>
      <label>
        Passwort
        <input
          v-model="password"
          type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          :minlength="mode === 'register' ? PASSWORD_MIN_LENGTH : undefined"
          required
        />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">
        {{ mode === 'login' ? 'Anmelden' : 'Registrieren' }}
      </button>
    </form>
    <p v-if="registrationOpen" class="switch">
      <button type="button" class="link" @click="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === 'login' ? 'Neues Konto erstellen' : 'Bereits registriert? Anmelden' }}
      </button>
    </p>
  </main>
</template>
