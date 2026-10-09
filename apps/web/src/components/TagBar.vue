<script setup lang="ts">
import { TAG_NAME_MAX_LENGTH } from '@notion-alt/shared'
import { computed, ref } from 'vue'
import { useLiveQuery } from '../composables/live-query'
import { useWorkspace } from '../composables/workspace'

const props = defineProps<{ documentId: string }>()
const { store, workspaceId, readOnly } = useWorkspace()

const tags = useLiveQuery(
  () => store.tagsForDocument(props.documentId),
  [],
  () => props.documentId,
)
const allTags = useLiveQuery(() => store.listTags(workspaceId.value), [], workspaceId)
const suggestions = computed(() => {
  const assigned = new Set(tags.value.map((t) => t.id))
  return allTags.value.filter((t) => !assigned.has(t.id))
})

const name = ref('')
const listId = `tag-suggestions-${props.documentId}`

async function add() {
  const value = name.value.trim()
  if (!value) return
  await store.addTag(props.documentId, value)
  name.value = ''
}
</script>

<template>
  <div class="tag-bar" aria-label="Tags">
    <span v-for="tag in tags" :key="tag.id" class="tag">
      <RouterLink :to="{ name: 'tag', params: { workspaceId, tagId: tag.id } }"
        >#{{ tag.name }}</RouterLink
      >
      <button
        v-if="!readOnly"
        type="button"
        class="icon"
        :aria-label="`Tag ${tag.name} entfernen`"
        @click="store.removeTag(documentId, tag.id)"
      >
        ×
      </button>
    </span>
    <form v-if="!readOnly" class="tag-form" @submit.prevent="add">
      <input
        v-model="name"
        :list="listId"
        :maxlength="TAG_NAME_MAX_LENGTH"
        placeholder="+ Tag"
        aria-label="Tag hinzufügen"
      />
      <datalist :id="listId">
        <option v-for="tag in suggestions" :key="tag.id" :value="tag.name"></option>
      </datalist>
    </form>
  </div>
</template>
