<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { deviceStatus } from '../device'
import { closeLocalStore, refreshWorkspaces, requireStore, workspaces } from '../local/context'
import { ReadOnlyWorkspaceError } from '../local/store'
import type { LocalStore } from '../local/store'
import {
  discardLocalArea,
  openLocalArea,
  parentPageTitle,
  planTakeover,
  readTakeover,
  runTakeover,
  startTakeover,
  takeoverConfirmed,
  targetWithoutAsking,
  type TakeoverState,
} from '../local/takeover'
import { connection, currentUser, signedOut } from '../session'
import { requestSync, syncState } from '../sync/engine'

/**
 * After signing in: the pages made without an account move into the account (ADR 0023). Asks
 * where to only when the account has pages already; there is no "later" (ADR 0023).
 */
const router = useRouter()
const account = requireStore()
let local: LocalStore | null = null

const phase = ref<'checking' | 'choose' | 'running' | 'done' | 'error'>('checking')
const pages = ref(0)
const done = ref(0)
const error = ref<string | null>(null)
const choice = ref<string>('new')
const newName = ref('Von diesem Gerät')
const state = ref<TakeoverState | null>(null)
/** The server confirmed all taken-over pages (#204). */
const synced = ref(false)

const targets = computed(() =>
  workspaces.value.filter((w) => !w.local && !w.revoked && !account.isReadOnly(w.id)),
)
const online = computed(() => connection.value === 'online')
const parentTitle = parentPageTitle(new Date())
const pagesText = computed(() => (pages.value === 1 ? '1 Seite' : `${pages.value} Seiten`))
const preview = computed(() => {
  const come = pages.value === 1 ? 'kommt' : 'kommen'
  if (choice.value === 'new') {
    return `${pagesText.value} ${come} in den neuen Workspace „${newName.value.trim() || '…'}“.`
  }
  const target = targets.value.find((w) => w.id === choice.value)
  return `${pagesText.value} ${come} in „${target?.name ?? ''}“ unter die neue Seite „${parentTitle}“. Was dort schon ist, bleibt unverändert.`
})

onMounted(load)
onUnmounted(() => local?.db.close())

async function load() {
  phase.value = 'checking'
  error.value = null
  try {
    local ??= await openLocalArea()
    const plan = await planTakeover(local, currentUser.value!.id)
    if (plan.kind === 'resume') return await run(plan.state)
    if (plan.kind !== 'start') return void router.replace({ name: 'home' })
    pages.value = plan.pages
    // Learn which pages the account has before deciding whether to ask: only a sync run that
    // finished after this point without error counts (the device must be registered for it).
    const since = new Date().toISOString()
    await refreshWorkspaces(account)
    await requestSync(account)
    const { lastSyncAt, lastError } = syncState.value
    const known = deviceStatus.value === 'registered' && !lastError && (lastSyncAt ?? '') >= since
    const target = known ? await targetWithoutAsking(account, currentUser.value!.id) : null
    if (target) return await begin(target, false)
    choose()
  } catch {
    fail('Die Übernahme konnte nicht starten. Deine Seiten sind weiterhin auf diesem Gerät.')
  }
}

function choose(message: string | null = null) {
  choice.value = targets.value[0]?.id ?? 'new'
  error.value = message
  phase.value = 'choose'
}

function fail(message: string) {
  error.value = message
  phase.value = 'error'
}

/** Into an existing workspace the pages go below a new parent page; into a new one on top. */
async function begin(workspaceId: string | 'new', underParentPage: boolean) {
  error.value = null
  let target = workspaceId
  try {
    if (target === 'new') {
      target = (await api.createWorkspace({ name: newName.value.trim() })).workspace.id
      await refreshWorkspaces(account)
    }
  } catch {
    return choose(
      'Der neue Workspace konnte nicht angelegt werden. Ist der Server erreichbar? Deine Seiten bleiben auf diesem Gerät.',
    )
  }
  const started = await startTakeover(local!, account, {
    userId: currentUser.value!.id,
    workspaceId: target,
    underParentPage,
    // Chosen again after the earlier target failed: that target is given up.
    replace: state.value !== null,
  })
  await run(started)
}

async function run(next: TakeoverState) {
  state.value = next
  phase.value = 'running'
  error.value = null
  try {
    await runTakeover(local!, account, next, (count, total) => {
      done.value = count
      pages.value = total
    })
  } catch (cause) {
    if (cause instanceof ReadOnlyWorkspaceError) {
      await refreshWorkspaces(account)
      return choose(
        'In diesem Workspace darfst du keine Seiten mehr anlegen. Bitte wähle ein anderes Ziel.',
      )
    }
    return fail('Die Übernahme wurde unterbrochen. Deine Seiten sind weiterhin auf diesem Gerät.')
  }
  phase.value = 'done'
  void finish()
}

/** Sends the pages; once the server has everything, the local area is no longer needed. */
async function finish() {
  try {
    await requestSync(account)
    const completed = local && (await readTakeover(local))
    if (local && completed && (await takeoverConfirmed(local, account, completed))) {
      await discardLocalArea(local)
      local = null
      synced.value = true
    }
  } catch {
    // Left the view meanwhile: the next start checks again.
  }
}

/** Way out when the takeover keeps failing; it continues at the next sign-in. */
async function signOut() {
  try {
    await api.logout()
  } catch {
    return fail('Abmelden fehlgeschlagen. Ist der Server erreichbar?')
  }
  closeLocalStore()
  signedOut()
  await router.push({ name: 'login' })
}

function open() {
  const target = state.value!
  void router.push(
    target.parentId
      ? { name: 'page', params: { workspaceId: target.workspaceId, documentId: target.parentId } }
      : { name: 'workspace', params: { workspaceId: target.workspaceId } },
  )
}
</script>

<template>
  <main class="card" aria-live="polite">
    <template v-if="phase === 'checking'">
      <h1>Deine Seiten von diesem Gerät</h1>
      <p class="muted">Einen Moment …</p>
    </template>

    <form
      v-else-if="phase === 'choose'"
      class="choose"
      @submit.prevent="begin(choice, choice !== 'new')"
    >
      <h1>Wohin mit deinen Seiten?</h1>
      <p>
        Auf diesem Gerät gibt es {{ pagesText }}, die du ohne Konto angelegt hast. Sie kommen jetzt
        in dein Konto.
      </p>
      <fieldset>
        <legend>Ziel</legend>
        <label v-for="workspace in targets" :key="workspace.id" class="check">
          <input v-model="choice" type="radio" name="target" :value="workspace.id" />
          {{ workspace.name }}
        </label>
        <label class="check">
          <input v-model="choice" type="radio" name="target" value="new" :disabled="!online" />
          Neuer Workspace
        </label>
        <input
          v-if="choice === 'new'"
          v-model="newName"
          aria-label="Name des neuen Workspace"
          maxlength="100"
          required
        />
      </fieldset>
      <p class="muted" data-testid="takeover-preview">{{ preview }}</p>
      <p v-if="choice === 'new' && !online" class="muted">
        Für einen neuen Workspace braucht es eine Verbindung zum Server.
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="choice === 'new' && !online">Seiten übernehmen</button>
    </form>

    <template v-else-if="phase === 'running'">
      <h1>Seiten werden übernommen</h1>
      <progress :value="done" :max="pages || 1" aria-label="Fortschritt" />
      <p class="muted">{{ done }} von {{ pagesText }}</p>
    </template>

    <template v-else-if="phase === 'done'">
      <h1>{{ pages === 1 ? '1 Seite übernommen' : `${pages} Seiten übernommen` }}</h1>
      <p class="muted" data-testid="takeover-done">
        <template v-if="synced">
          Sie sind jetzt in deinem Konto und auf allen deinen Geräten verfügbar.
        </template>
        <template v-else-if="online">
          Sie sind jetzt in deinem Konto und werden gerade synchronisiert.
        </template>
        <template v-else>
          Sie sind jetzt in deinem Konto und werden synchronisiert, sobald eine Verbindung besteht.
        </template>
      </p>
      <button type="button" data-testid="takeover-open" @click="open">Zu den Seiten</button>
    </template>

    <template v-else>
      <h1>Übernahme nicht abgeschlossen</h1>
      <p class="error" role="alert">{{ error }}</p>
      <div class="row">
        <button type="button" @click="load">Erneut versuchen</button>
        <button v-if="state" type="button" class="link" @click="choose()">
          Anderes Ziel wählen
        </button>
        <button type="button" class="link" @click="signOut">Abmelden</button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.choose,
fieldset {
  display: grid;
  gap: var(--space-md);
}

fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--space-sm);
  font-weight: 600;
}

.check {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

progress {
  width: 100%;
}
</style>
