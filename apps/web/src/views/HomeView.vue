<script setup lang="ts">
import type { Workspace } from '@notion-alt/shared'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { currentUser, setCurrentUser } from '../session'

const router = useRouter()
const workspaces = ref<Workspace[]>([])
const newName = ref('')
const error = ref<string | null>(null)

onMounted(async () => {
  workspaces.value = (await api.listWorkspaces()).workspaces
})

async function createWorkspace() {
  error.value = null
  try {
    const { workspace } = await api.createWorkspace({ name: newName.value })
    workspaces.value.push(workspace)
    newName.value = ''
  } catch {
    error.value = 'Workspace konnte nicht angelegt werden.'
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
      <li v-for="workspace in workspaces" :key="workspace.id">{{ workspace.name }}</li>
    </ul>
    <form class="row" @submit.prevent="createWorkspace">
      <input v-model="newName" placeholder="Neuer Workspace" maxlength="100" required />
      <button type="submit">Anlegen</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>
