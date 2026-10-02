<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { closeLocalStore, refreshWorkspaces, requireStore, workspaces } from '../local/context'
import { connection, currentUser, setCurrentUser } from '../session'

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

async function logout() {
  error.value = null
  try {
    await api.logout()
  } catch {
    error.value = 'Abmelden fehlgeschlagen. Ist der Server erreichbar?'
    return
  }
  // Local data stays on the device (ADR 0009); only the cached sign-in is removed.
  closeLocalStore()
  setCurrentUser(null)
  await router.push({ name: 'login' })
}
</script>

<template>
  <main class="card">
    <header class="row">
      <h1>Workspaces</h1>
      <button type="button" class="link" @click="logout">Abmelden</button>
    </header>
    <p class="muted">Angemeldet als {{ currentUser?.email }}</p>
    <ul class="list">
      <li v-for="workspace in workspaces" :key="workspace.id">
        <RouterLink :to="{ name: 'workspace', params: { workspaceId: workspace.id } }">
          {{ workspace.name }}
        </RouterLink>
      </li>
    </ul>
    <p v-if="workspaces.length === 0" class="muted">
      Keine Workspaces auf diesem Gerät. Beim ersten Start wird eine Serververbindung benötigt.
    </p>
    <form class="row" @submit.prevent="createWorkspace">
      <input v-model="newName" placeholder="Neuer Workspace" maxlength="100" required />
      <button type="submit" :disabled="connection !== 'online'">Anlegen</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>
