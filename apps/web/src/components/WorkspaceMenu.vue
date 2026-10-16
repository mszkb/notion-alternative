<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { refreshWorkspaces, requireStore, workspaces } from '../local/context'
import { connection, currentUser } from '../session'
import { ROLE_LABELS } from '../sharing'
import LogoutDialog from './LogoutDialog.vue'

/**
 * Menu on the workspace name at the top of the sidebar, as in Notion (#196): switch and create
 * workspaces, settings, sign out. Without an account: this device and signing in.
 */
const props = defineProps<{ workspaceId: string }>()
const router = useRouter()

const open = ref(false)
const creating = ref(false)
const newName = ref('')
const error = ref<string | null>(null)
const signingOut = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

const withoutAccount = computed(() => connection.value === 'local')
const online = computed(() => connection.value === 'online')
const current = computed(() => workspaces.value.find((w) => w.id === props.workspaceId))

function roleNote(workspace: (typeof workspaces.value)[number]): string | null {
  if (workspace.revoked) return 'Zugriff entzogen'
  if (workspace.role && workspace.ownerId !== currentUser.value?.id)
    return `geteilt · ${ROLE_LABELS[workspace.role]}`
  return null
}

function items(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
}

async function show() {
  open.value = true
  creating.value = false
  error.value = null
  await nextTick()
  items()[0]?.focus()
}

function close(returnFocus = true) {
  open.value = false
  creating.value = false
  if (returnFocus) trigger.value?.focus()
}

function onTriggerKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    void show()
  }
}

/** Arrow keys, Home and End move between the entries (WAI-ARIA menu pattern). */
function onMenuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (creating.value) return
  const list = items()
  const index = list.indexOf(document.activeElement as HTMLElement)
  let next: number | null = null
  if (event.key === 'ArrowDown') next = (index + 1) % list.length
  else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = list.length - 1
  else if (event.key === 'Tab') close(false)
  if (next === null) return
  event.preventDefault()
  list[next]?.focus()
}

function closeOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close(false)
}
watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('pointerdown', closeOutside)
  else window.removeEventListener('pointerdown', closeOutside)
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOutside))

async function switchTo(id: string) {
  close(false)
  if (id !== props.workspaceId)
    await router.push({ name: 'workspace', params: { workspaceId: id } })
}

async function startCreate() {
  creating.value = true
  newName.value = ''
  error.value = null
  await nextTick()
  nameInput.value?.focus()
}

async function create() {
  error.value = null
  try {
    const { workspace } = await api.createWorkspace({ name: newName.value })
    await refreshWorkspaces(requireStore())
    close(false)
    await router.push({ name: 'workspace', params: { workspaceId: workspace.id } })
  } catch {
    error.value = 'Workspace konnte nicht angelegt werden. Ist der Server erreichbar?'
  }
}

async function go(name: 'account' | 'login') {
  close(false)
  await router.push({ name })
}

function startLogout() {
  close(false)
  signingOut.value = true
}
</script>

<template>
  <div ref="root" class="workspace-menu" @keydown="onMenuKey">
    <button
      ref="trigger"
      type="button"
      class="workspace-name"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-controls="workspace-menu"
      data-testid="workspace-menu"
      @click="open ? close() : show()"
      @keydown="onTriggerKey"
    >
      {{ current?.name ?? 'Workspace' }}
    </button>
    <div
      v-if="open"
      id="workspace-menu"
      ref="menu"
      class="block-menu workspace-menu-list"
      role="menu"
      aria-label="Workspace"
    >
      <form v-if="creating" class="workspace-create" @submit.prevent="create">
        <label>
          Name des neuen Workspace
          <input ref="nameInput" v-model="newName" maxlength="100" required />
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="row">
          <button type="button" class="link" @click="creating = false">Abbrechen</button>
          <button type="submit" :disabled="!online">Anlegen</button>
        </div>
      </form>
      <template v-else>
        <p v-if="currentUser && !withoutAccount" class="menu-note muted">
          {{ currentUser.email }}
        </p>
        <button
          v-for="workspace in workspaces"
          :key="workspace.id"
          type="button"
          role="menuitem"
          class="workspace-item"
          :aria-current="workspace.id === workspaceId ? 'true' : undefined"
          @click="switchTo(workspace.id)"
        >
          <span class="check" aria-hidden="true">{{
            workspace.id === workspaceId ? '✓' : ''
          }}</span>
          <span class="workspace-item-name">{{ workspace.name }}</span>
          <small v-if="roleNote(workspace)" class="muted">{{ roleNote(workspace) }}</small>
        </button>
        <div class="separator" role="separator"></div>
        <template v-if="withoutAccount">
          <button type="button" role="menuitem" data-testid="menu-sign-in" @click="go('login')">
            Anmelden
          </button>
          <p class="menu-note muted">
            Mit einem Konto auf einem eigenen Server werden die Seiten auf allen Geräten
            synchronisiert.
          </p>
        </template>
        <template v-else>
          <button
            type="button"
            role="menuitem"
            :disabled="!online"
            :aria-describedby="online ? undefined : 'workspace-menu-offline'"
            @click="startCreate"
          >
            Neuer Workspace
          </button>
          <button type="button" role="menuitem" @click="go('account')">Einstellungen</button>
          <button type="button" role="menuitem" @click="startLogout">Abmelden</button>
          <p v-if="!online" id="workspace-menu-offline" class="menu-note muted">
            Offline: Neue Workspaces brauchen den Server. Abmelden geht, die Anmeldung endet aber
            erst online.
          </p>
        </template>
      </template>
    </div>
    <LogoutDialog v-if="signingOut" @close="signingOut = false" />
  </div>
</template>
