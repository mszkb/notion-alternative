<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, useWorkspace } from '../composables/workspace'

const { store, workspaceId } = useWorkspace()
const router = useRouter()
const trashed = useLiveQuery(() => store.trashedDocuments(workspaceId.value), [], workspaceId)
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

async function restore(id: string) {
  await store.restoreDocument(id)
  await router.push({ name: 'page', params: { workspaceId: workspaceId.value, documentId: id } })
}
</script>

<template>
  <article class="page trash">
    <h1>Papierkorb</h1>
    <p class="muted">
      Gelöschte Seiten bleiben hier, bis sie wiederhergestellt werden – mit Unterseiten, Inhalten,
      Tags und Links. Das geht auch offline.
    </p>
    <p v-if="trashed.length === 0" class="muted" data-testid="trash-empty">
      Der Papierkorb ist leer.
    </p>
    <ul class="trash-list" aria-label="Gelöschte Seiten">
      <li v-for="document in trashed" :key="document.id">
        <span>
          <strong>{{ displayTitle(document) }}</strong>
          <small class="muted">
            gelöscht {{ dateFormat.format(new Date(document.deletedAt!)) }}
          </small>
        </span>
        <button type="button" @click="restore(document.id)">Wiederherstellen</button>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.trash-list {
  display: grid;
  gap: var(--space-md);
  padding: 0;
  list-style: none;
}

.trash-list li {
  display: flex;
  gap: var(--space-lg);
  align-items: center;
  justify-content: space-between;
}

.trash-list small {
  display: block;
}
</style>
