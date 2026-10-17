<script setup lang="ts">
import type { Document } from '@notion-alt/shared'
import { computed, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { expanded } from '../composables/tree-state'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue'
import { displayTitle, NO_CHILDREN, useWorkspace } from '../composables/workspace'
import NavIcon from './NavIcon.vue'

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

// Own context menu (#191); Shift+right click keeps the browser's.
const contextMenu = shallowRef<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

function menuItems(): ContextMenuItem[] {
  const url = new URL(pageHref(props.document.id), window.location.href).href
  const items: ContextMenuItem[] = []
  if (!readOnly.value) {
    items.push({ label: 'Unterseite anlegen', run: addChild })
    items.push({
      label: props.document.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen',
      run: () => store.setFavorite(props.document.id, !props.document.favorite),
    })
  }
  items.push(
    { label: 'In neuem Tab öffnen', run: () => window.open(url, '_blank', 'noopener') },
    {
      label: 'Link kopieren',
      run: async () => {
        try {
          await navigator.clipboard.writeText(url)
        } catch {
          window.prompt('Link', url)
        }
      },
    },
  )
  if (!readOnly.value)
    items.push({ label: 'Löschen', danger: true, separated: true, run: removePage })
  return items
}

function onContextMenu(event: MouseEvent) {
  if (event.shiftKey) return
  event.preventDefault()
  contextMenu.value = { x: event.clientX, y: event.clientY, items: menuItems() }
}

function onLinkKeydown(event: KeyboardEvent) {
  if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    contextMenu.value = { x: box.left, y: box.bottom, items: menuItems() }
  }
}

async function removePage() {
  const message = children.value.length
    ? `„${displayTitle(props.document)}“ und alle Unterseiten löschen?`
    : `„${displayTitle(props.document)}“ löschen?`
  if (!window.confirm(message)) return
  const wasOpen = activeDocumentId.value === props.document.id
  await store.deleteDocument(props.document.id)
  if (wasOpen) await router.push({ name: 'workspace', params: { workspaceId: workspaceId.value } })
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
      :style="{ paddingLeft: `${depth * 0.9 + 0.5}rem` }"
      :draggable="!readOnly"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="dropZone = null"
      @drop="onDrop"
      @contextmenu="onContextMenu"
    >
      <!-- The page icon stands where the arrow goes; the arrow shows on hover or focus, so top
           level pages line up with the other entries (#203). -->
      <button
        v-if="children.length"
        type="button"
        class="icon toggle"
        :aria-label="isOpen ? 'Zuklappen' : 'Aufklappen'"
        @click="toggle"
      >
        <span class="tree-icon" aria-hidden="true">
          <template v-if="document.icon">{{ document.icon }}</template>
          <NavIcon v-else name="page" />
        </span>
        <span class="tree-arrow" aria-hidden="true">{{ isOpen ? '▾' : '▸' }}</span>
      </button>
      <span v-else class="icon toggle" aria-hidden="true" data-testid="tree-icon">
        <span class="tree-icon">
          <template v-if="document.icon">{{ document.icon }}</template>
          <NavIcon v-else name="page" />
        </span>
      </span>
      <a
        class="tree-link"
        :href="pageHref(document.id)"
        :aria-current="isActive ? 'page' : undefined"
        @click="open"
        @keydown="onLinkKeydown"
      >
        {{ displayTitle(document) }}
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
    <ContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @close="contextMenu = null"
    />
    <ul v-if="isOpen && children.length" role="group">
      <TreeNode v-for="child in children" :key="child.id" :document="child" :depth="depth + 1" />
    </ul>
  </li>
</template>
