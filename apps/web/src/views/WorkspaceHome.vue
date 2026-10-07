<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { pageLabel, useWorkspace } from '../composables/workspace'

const { store, workspaceId, documents } = useWorkspace()
const router = useRouter()

const recent = computed(() =>
  [...documents.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10),
)

async function createPage() {
  const created = await store.createDocument({ workspaceId: workspaceId.value })
  await router.push({
    name: 'page',
    params: { workspaceId: workspaceId.value, documentId: created.id },
  })
}
</script>

<template>
  <section class="page">
    <h1>Willkommen</h1>
    <p class="muted">
      Alle Seiten liegen lokal auf diesem Gerät und bleiben auch ohne Server bearbeitbar.
    </p>
    <button type="button" @click="createPage">Neue Seite</button>

    <section v-if="recent.length" class="page-section" aria-labelledby="home-recent">
      <h2 id="home-recent">Zuletzt bearbeitet</h2>
      <ul class="link-list">
        <li v-for="doc in recent" :key="doc.id">
          <RouterLink :to="{ name: 'page', params: { workspaceId, documentId: doc.id } }">
            {{ pageLabel(doc) }}
          </RouterLink>
          <small class="muted">{{ new Date(doc.updatedAt).toLocaleString() }}</small>
        </li>
      </ul>
    </section>
  </section>
</template>
