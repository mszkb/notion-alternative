<script setup lang="ts">
import type { ShareLink } from '@notion-alt/shared'
import { onMounted, ref } from 'vue'
import { ApiError, api } from '../api'
import { connection } from '../session'

/**
 * Read links of a page (ADR 0022): anyone with the link sees the page read-only, without an
 * account. Online only; the token is shown once, right after creating the link.
 */
const props = defineProps<{ workspaceId: string; documentId: string }>()
const emit = defineEmits<{ close: [] }>()

/** Validity choices in days; `null` = no expiry. */
const VALIDITY = [
  { days: 1, label: '1 Tag' },
  { days: 7, label: '7 Tage' },
  { days: 30, label: '30 Tage' },
  { days: 365, label: '1 Jahr' },
  { days: null, label: 'Unbefristet' },
] as const

const links = ref<ShareLink[] | null>(null)
const validity = ref<number | null>(30)
const created = ref<{ id: string; url: string } | null>(null)
const copied = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

onMounted(async () => {
  closeButton.value?.focus()
  await load()
})

async function load() {
  if (connection.value !== 'online') return
  try {
    links.value = (await api.listShareLinks(props.workspaceId, props.documentId)).links
  } catch {
    error.value = 'Die Links konnten nicht geladen werden.'
  }
}

/** The address guests open; the SPA renders it without signing in. */
function shareUrl(token: string): string {
  return new URL(`/share/${token}`, window.location.origin).toString()
}

async function create() {
  busy.value = true
  error.value = null
  copied.value = false
  try {
    const expiresAt =
      validity.value === null
        ? null
        : new Date(Date.now() + validity.value * 86_400_000).toISOString()
    const { link, token } = await api.createShareLink(props.workspaceId, {
      documentId: props.documentId,
      expiresAt,
    })
    created.value = { id: link.id, url: shareUrl(token) }
    links.value = [link, ...(links.value ?? [])]
  } catch (e) {
    error.value =
      e instanceof ApiError && e.code === 'document_not_found'
        ? 'Die Seite ist noch nicht mit dem Server synchronisiert. Versuche es gleich noch einmal.'
        : 'Der Link konnte nicht angelegt werden.'
  } finally {
    busy.value = false
  }
}

async function copy() {
  if (!created.value) return
  try {
    await navigator.clipboard.writeText(created.value.url)
    copied.value = true
  } catch {
    // Without clipboard access the field stays selectable.
  }
}

async function revoke(link: ShareLink) {
  error.value = null
  try {
    await api.revokeShareLink(props.workspaceId, link.id)
  } catch (e) {
    // Already gone (revoked elsewhere): just drop it from the list.
    if (!(e instanceof ApiError && e.status === 404)) {
      error.value = 'Der Link konnte nicht widerrufen werden.'
      return
    }
  }
  links.value = (links.value ?? []).filter((l) => l.id !== link.id)
  if (created.value?.id === link.id) created.value = null
}

function expiry(link: ShareLink): string {
  if (link.expired) return 'abgelaufen'
  return link.expiresAt
    ? `gültig bis ${dateFormat.format(new Date(link.expiresAt))}`
    : 'unbefristet'
}
</script>

<template>
  <div class="palette-backdrop" @pointerdown.self="emit('close')" @keydown.escape="emit('close')">
    <div
      class="palette share-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      data-testid="share-dialog"
    >
      <header class="row">
        <h2 id="share-title">Lese-Link teilen</h2>
        <button
          ref="closeButton"
          type="button"
          class="icon"
          aria-label="Schließen"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <p class="muted">
        Wer den Link hat, kann diese Seite ohne Konto lesen – nicht bearbeiten, keine anderen
        Seiten. Mitglieder lädst du unter „Mitglieder“ ein.
      </p>
      <p v-if="connection !== 'online'" class="muted" data-testid="share-offline">
        Lese-Links brauchen eine Verbindung zum Server.
      </p>
      <template v-else>
        <form class="row share-create" @submit.prevent="create">
          <label>
            Gültig
            <select v-model="validity" data-testid="share-validity">
              <option v-for="choice in VALIDITY" :key="choice.label" :value="choice.days">
                {{ choice.label }}
              </option>
            </select>
          </label>
          <button type="submit" :disabled="busy" data-testid="share-create">Link erstellen</button>
        </form>
        <div v-if="created" class="share-created" role="status">
          <input
            :value="created.url"
            readonly
            aria-label="Lese-Link"
            data-testid="share-url"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button type="button" @click="copy">{{ copied ? 'Kopiert' : 'Kopieren' }}</button>
          <p class="muted">
            Kopiere den Link jetzt: Er wird nur einmal angezeigt. Verloren? Neuen Link erstellen und
            den alten widerrufen.
          </p>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <ul v-if="links && links.length > 0" class="share-links" aria-label="Lese-Links">
          <li v-for="link in links" :key="link.id" data-testid="share-link">
            <span>
              Erstellt {{ dateFormat.format(new Date(link.createdAt)) }} ·
              <span :class="{ error: link.expired }">{{ expiry(link) }}</span>
            </span>
            <button type="button" class="link danger" @click="revoke(link)">Widerrufen</button>
          </li>
        </ul>
        <p v-else-if="links" class="muted">Für diese Seite gibt es noch keine Lese-Links.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.share-dialog {
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-xl);
  overflow-y: auto;
}

.share-dialog h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.share-dialog p {
  margin: 0;
}

.share-create {
  gap: var(--space-md);
  align-items: center;
}

.share-create label {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.share-created {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.share-created input {
  flex: 1;
  min-width: 12rem;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.share-dialog ul.share-links {
  padding: 0;
}

.share-links li {
  display: flex;
  gap: var(--space-md);
  align-items: baseline;
  justify-content: space-between;
  padding: var(--space-xs) 0;
  font-size: var(--text-sm);
  border-top: 1px solid var(--border);
}
</style>
