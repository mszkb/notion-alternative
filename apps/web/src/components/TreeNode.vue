<script setup lang="ts">
import type { Document } from '@notion-alt/shared'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { expanded } from '../composables/tree-state'
import { displayTitle, useWorkspace } from '../composables/workspace'

const props = defineProps<{ document: Document; depth: number }>()

const { store, workspaceId, documents } = useWorkspace()
const route = useRoute()
const router = useRouter()

const children = computed(() => documents.value.filter((d) => d.parentId === props.document.id))
const isOpen = computed(() => expanded.has(props.document.id))
const isActive = computed(() => route.params.documentId === props.document.id)
const dropZone = ref<'before' | 'inside' | 'after' | null>(null)

function toggle() {
  if (isOpen.value) expanded.delete(props.document.id)
  else expanded.add(props.document.id)
}

async function addChild() {
  const created = await store.createDocument({
    workspaceId: workspaceId.value,
    parentId: props.document.id,
  })
  expanded.add(props.document.id)
  await router.push({
    name: 'page',
    params: { workspaceId: workspaceId.value, documentId: created.id },
  })
}

const DRAG_TYPE = 'application/x-notion-alt-page'

function onDragStart(event: DragEvent) {
  event.dataTransfer?.setData(DRAG_TYPE, props.document.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const y = (event.clientY - box.top) / box.height
  dropZone.value = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
}

async function onDrop(event: DragEvent) {
  const zone = dropZone.value
  dropZone.value = null
  const id = event.dataTransfer?.getData(DRAG_TYPE)
  if (!id || !zone || id === props.document.id) return
  event.preventDefault()
  const target = props.document
  const siblings = documents.value.filter((d) => d.parentId === target.parentId && d.id !== id)
  const index = siblings.findIndex((d) => d.id === target.id)
  try {
    if (zone === 'inside') {
      await store.moveDocument(id, target.id)
      expanded.add(target.id)
    } else if (zone === 'after') {
      await store.moveDocument(id, target.parentId, { afterId: target.id })
    } else {
      await store.moveDocument(id, target.parentId, { afterId: siblings[index - 1]?.id ?? null })
    }
  } catch (error) {
    // Moving a page below itself is refused by the store; nothing changes.
    console.warn(error)
  }
}
</script>

<template>
  <li class="tree-node" role="treeitem" :aria-expanded="children.length ? isOpen : undefined">
    <div
      class="tree-row"
      :class="{ active: isActive, [`drop-${dropZone}`]: dropZone }"
      :style="{ paddingLeft: `${depth * 0.9 + 0.25}rem` }"
      draggable="true"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="dropZone = null"
      @drop="onDrop"
    >
      <button
        type="button"
        class="icon toggle"
        :class="{ invisible: children.length === 0 }"
        :aria-label="isOpen ? 'Zuklappen' : 'Aufklappen'"
        @click="toggle"
      >
        {{ isOpen ? '▾' : '▸' }}
      </button>
      <RouterLink
        class="tree-link"
        :to="{ name: 'page', params: { workspaceId, documentId: document.id } }"
      >
        {{ displayTitle(document) }}
      </RouterLink>
      <button
        type="button"
        class="icon add"
        aria-label="Unterseite anlegen"
        title="Unterseite anlegen"
        @click="addChild"
      >
        +
      </button>
    </div>
    <ul v-if="isOpen && children.length" role="group">
      <TreeNode v-for="child in children" :key="child.id" :document="child" :depth="depth + 1" />
    </ul>
  </li>
</template>
