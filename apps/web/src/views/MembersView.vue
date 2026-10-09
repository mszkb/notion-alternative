<script setup lang="ts">
import { WORKSPACE_ROLES, type WorkspaceMember, type WorkspaceRole } from '@notion-alt/shared'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, ApiError } from '../api'
import { useWorkspace } from '../composables/workspace'
import { refreshWorkspaces, workspaces } from '../local/context'
import { connection, currentUser } from '../session'
import { ROLE_LABELS } from '../sharing'

/** Members of the workspace (ADR 0014); managing them needs the server. */
const { store, workspaceId, role } = useWorkspace()
const router = useRouter()

const workspace = computed(() => workspaces.value.find((w) => w.id === workspaceId.value))
const revoked = computed(() => !!workspace.value?.revoked)
const isOwner = computed(() => !revoked.value && role.value === 'owner')
const online = computed(() => connection.value === 'online')

const members = ref<WorkspaceMember[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const email = ref('')
const newRole = ref<WorkspaceRole>('editor')

const MESSAGES: Record<string, string> = {
  user_not_found: 'Auf diesem Server gibt es kein Konto mit dieser E-Mail-Adresse.',
  already_member: 'Dieses Konto ist schon Mitglied.',
  creator_fixed: 'Wer den Workspace angelegt hat, bleibt Besitzer.',
  forbidden: 'Mitglieder verwalten können nur Besitzer.',
  invalid_input: 'Bitte eine gültige E-Mail-Adresse eingeben.',
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message
  return 'Der Server ist nicht erreichbar. Mitglieder lassen sich nur online verwalten.'
}

async function load() {
  if (!online.value || revoked.value) return
  loading.value = true
  error.value = null
  try {
    members.value = (await api.listMembers(workspaceId.value)).members
  } catch (e) {
    error.value = describe(e)
  } finally {
    loading.value = false
  }
}
watch([workspaceId, online], load, { immediate: true })

async function run(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
    await load()
  } catch (e) {
    error.value = describe(e)
  }
}

function add() {
  return run(async () => {
    await api.addMember(workspaceId.value, { email: email.value, role: newRole.value })
    email.value = ''
  })
}

function changeRole(member: WorkspaceMember, next: WorkspaceRole) {
  return run(() => api.setMemberRole(workspaceId.value, member.userId, next))
}

function remove(member: WorkspaceMember) {
  const ok = window.confirm(
    `${member.email} entfernen? Der Server liefert diesem Konto nichts mehr aus dem Workspace. ` +
      'Was schon auf seinen Geräten liegt, lässt sich nicht löschen; es bleibt dort lesbar.',
  )
  if (ok) return run(() => api.removeMember(workspaceId.value, member.userId))
}

async function leave() {
  const ok = window.confirm(
    'Workspace verlassen? Die Seiten bleiben auf diesem Gerät lesbar, bis du sie entfernst; ' +
      'ändern und synchronisieren geht danach nicht mehr.',
  )
  if (!ok || !currentUser.value) return
  error.value = null
  try {
    await api.removeMember(workspaceId.value, currentUser.value.id)
    await refreshWorkspaces(store)
  } catch (e) {
    error.value = describe(e)
  }
}

async function forget() {
  const ok = window.confirm(
    'Alle Seiten dieses Workspace und nicht übertragene Änderungen von diesem Gerät löschen? ' +
      'Exportiere vorher, was du behalten möchtest.',
  )
  if (!ok) return
  await store.forgetWorkspace(workspaceId.value)
  workspaces.value = await store.cachedWorkspaces()
  await router.push({ name: 'home', query: { choose: '1' } })
}

const self = computed(() => members.value.find((m) => m.userId === currentUser.value?.id))
</script>

<template>
  <article class="page members">
    <h1>Mitglieder</h1>

    <template v-if="revoked">
      <p>
        Du hast keinen Zugriff mehr auf diesen Workspace. Die Seiten auf diesem Gerät bleiben
        lesbar, bis du sie entfernst.
      </p>
      <p>
        <RouterLink :to="{ name: 'export', params: { workspaceId } }">Erst exportieren</RouterLink>
        ·
        <button type="button" class="danger" data-testid="forget-workspace" @click="forget">
          Vom Gerät entfernen
        </button>
      </p>
    </template>

    <template v-else>
      <p class="muted">
        Mitglieder sehen alle Seiten dieses Workspace. Einladen lassen sich Konten auf diesem
        Server, eine E-Mail wird nicht verschickt.
      </p>
      <p v-if="!online" class="notice" data-testid="members-offline">
        Mitglieder lassen sich nur mit Verbindung zum Server anzeigen und verwalten. Deine Rolle:
        {{ ROLE_LABELS[role] }}.
      </p>
      <p v-if="error" class="error" role="alert" data-testid="members-error">{{ error }}</p>

      <ul v-if="online" class="member-list" aria-label="Mitglieder" :aria-busy="loading">
        <li v-for="member in members" :key="member.userId" data-testid="member">
          <span>
            <strong>{{ member.email }}</strong>
            <small v-if="member.creator" class="muted"> hat den Workspace angelegt</small>
            <small v-if="member.userId === currentUser?.id" class="muted"> (du)</small>
          </span>
          <select
            v-if="isOwner && !member.creator"
            :value="member.role"
            :aria-label="`Rolle von ${member.email}`"
            @change="
              changeRole(member, ($event.target as HTMLSelectElement).value as WorkspaceRole)
            "
          >
            <option v-for="r in WORKSPACE_ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
          </select>
          <span v-else class="muted">{{ ROLE_LABELS[member.role] }}</span>
          <button
            v-if="isOwner && !member.creator && member.userId !== currentUser?.id"
            type="button"
            class="link"
            @click="remove(member)"
          >
            Entfernen
          </button>
        </li>
      </ul>

      <form v-if="online && isOwner" class="row add-member" @submit.prevent="add">
        <input
          v-model="email"
          type="email"
          required
          placeholder="E-Mail-Adresse"
          aria-label="E-Mail-Adresse des Kontos"
        />
        <select v-model="newRole" aria-label="Rolle">
          <option v-for="r in WORKSPACE_ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
        </select>
        <button type="submit">Hinzufügen</button>
      </form>

      <p v-if="online && self && !self.creator">
        <button type="button" class="link" data-testid="leave-workspace" @click="leave">
          Workspace verlassen
        </button>
      </p>

      <h2>Rollen</h2>
      <dl class="roles">
        <dt>{{ ROLE_LABELS.reader }}</dt>
        <dd>Seiten lesen, durchsuchen und exportieren.</dd>
        <dt>{{ ROLE_LABELS.commenter }}</dt>
        <dd>Wie Lesen; Kommentare folgen in einer späteren Version.</dd>
        <dt>{{ ROLE_LABELS.editor }}</dt>
        <dd>Seiten anlegen, ändern, verschieben und löschen.</dd>
        <dt>{{ ROLE_LABELS.owner }}</dt>
        <dd>Zusätzlich Mitglieder einladen, Rollen ändern und Mitglieder entfernen.</dd>
      </dl>
    </template>
  </article>
</template>

<style scoped>
.member-list {
  display: grid;
  gap: var(--space-md);
  padding: 0;
  list-style: none;
}

.member-list li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  align-items: center;
  justify-content: space-between;
}

.member-list li > span:first-child {
  flex: 1;
}

.add-member {
  flex-wrap: wrap;
  margin-top: var(--space-xl);
}

.add-member input {
  flex: 1;
  min-width: 12rem;
}

.roles dt {
  font-weight: 600;
}

.roles dd {
  margin: 0 0 var(--space-sm);
}
</style>
