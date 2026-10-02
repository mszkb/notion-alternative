<script setup lang="ts">
import type { Tag } from '@notion-alt/shared'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, useWorkspace } from '../composables/workspace'

const { store, workspaceId } = useWorkspace()
const route = useRoute()
const tagId = computed(() => String(route.params.tagId))

const tag = useLiveQuery<Tag | null | undefined>(
  async () => (await store.db.tags.get(tagId.value)) ?? null,
  undefined,
  tagId,
)
const pages = useLiveQuery(() => store.documentsForTag(tagId.value), [], tagId)
</script>

<template>
  <section class="page">
    <h1 v-if="tag">#{{ tag.name }}</h1>
    <h1 v-else-if="tag === null">Tag nicht gefunden</h1>
    <ul v-if="pages.length" class="link-list">
      <li v-for="page in pages" :key="page.id">
        <RouterLink :to="{ name: 'page', params: { workspaceId, documentId: page.id } }">
          {{ displayTitle(page) }}
        </RouterLink>
      </li>
    </ul>
    <p v-else-if="tag" class="muted">Keine Seiten mit diesem Tag.</p>
  </section>
</template>
