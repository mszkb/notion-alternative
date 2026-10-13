<script setup lang="ts">
import type { Document } from '@notion-alt/shared'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { expanded } from '../composables/tree-state'
import { NO_CHILDREN, pageLabel, useWorkspace } from '../composables/workspace'

const props = defineProps<{ document: Document; depth: number }>()

const { store, workspaceId, documents, childrenByParent, activeDocumentId, pageHref, readOnly } =
  useWorkspace()
const router = useRouter()

const children = computed(() => childrenByParent.value.get(props.document.id) ?? NO_CHILDREN)
const isOpen = computed(() => expanded.has(props.document.id))
const isActive = computed(() => activeDocumentId.value === props.document.id)
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

/**
 * A plain link instead of RouterLink (#102): its per-link route resolution was a noticeable part
 * of mounting 10 000 nodes. Modified clicks stay with the browser (new tab or window), as there.
 */
function open(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(pageHref(props.document.id))
}

const DRAG_TYPE = 'application/x-notion-alt-page'

function onDragStart(event: DragEvent) {
  event.dataTransfer?.setData(DRAG_TYPE, props.document.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent) {
  if (readOnly.value || !event.dataTransfer?.types.includes(DRAG_TYPE)) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const y = (event.clientY - box.top) / box.height
  dropZone.value = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
}

async function onDrop(event: DragEvent) {
  if (readOnly.value) return
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
      :draggable="!readOnly"
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
      <a
        class="tree-link"
        :href="pageHref(document.id)"
        :aria-current="isActive ? 'page' : undefined"
        @click="open"
      >
        {{ pageLabel(document) }}
      </a>
      <button
        v-if="!readOnly"
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
