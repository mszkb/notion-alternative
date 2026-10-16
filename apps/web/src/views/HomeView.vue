<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import LogoutDialog from '../components/LogoutDialog.vue'
import { refreshWorkspaces, requireStore, workspaces } from '../local/context'
import { connection, currentUser } from '../session'
import { ROLE_LABELS } from '../sharing'

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

const signingOut = ref(false)
</script>

<template>
  <main class="card">
    <header class="row">
      <h1>Workspaces</h1>
      <span class="row">
        <RouterLink :to="{ name: 'account' }">Konto</RouterLink>
        <button type="button" class="link" @click="signingOut = true">Abmelden</button>
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
    <LogoutDialog v-if="signingOut" @close="signingOut = false" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>
