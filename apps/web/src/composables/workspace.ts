import type { Document } from '@notion-alt/shared'
import { inject, type InjectionKey, type Ref } from 'vue'
import type { LocalStore } from '../local/store'

export interface WorkspaceContext {
  store: LocalStore
  workspaceId: Readonly<Ref<string>>
  /** All active documents of the workspace (live). */
  documents: Readonly<Ref<Document[]>>
  documentsById: Readonly<Ref<Map<string, Document>>>
  /** Active documents per parent id (null = top level), in tree order (#102). */
  childrenByParent: Readonly<Ref<Map<string | null, Document[]>>>
}

/** Shared empty child list: a leaf's computed stays the same value across updates. */
export const NO_CHILDREN: readonly Document[] = Object.freeze([])

/**
 * Groups documents by parent in one pass (#102). Filtering the whole list per tree node was
 * quadratic: 100 million comparisons per update at 10 000 pages.
 */
export function groupByParent(documents: Document[]): Map<string | null, Document[]> {
  const groups = new Map<string | null, Document[]>()
  for (const document of documents) {
    const list = groups.get(document.parentId)
    if (list) list.push(document)
    else groups.set(document.parentId, [document])
  }
  return groups
}

const SAME_FIELDS = [
  'title',
  'parentId',
  'sortKey',
  'favorite',
  'updatedAt',
  'revision',
  'deletedAt',
  'createdAt',
  'workspaceId',
] as const

/**
 * Keeps the previous object of every unchanged document (#102): a reloaded list then only
 * re-renders the tree nodes whose document really changed.
 */
export function reuseUnchanged(previous: Document[], next: Document[]): Document[] {
  if (previous.length === 0) return next
  const old = new Map(previous.map((d) => [d.id, d]))
  return next.map((d) => {
    const before = old.get(d.id)
    return before && SAME_FIELDS.every((field) => before[field] === d[field]) ? before : d
  })
}

export const workspaceKey: InjectionKey<WorkspaceContext> = Symbol('workspace')

export function useWorkspace(): WorkspaceContext {
  const context = inject(workspaceKey)
  if (!context) throw new Error('useWorkspace() outside of the workspace layout')
  return context
}

export function displayTitle(document: Pick<Document, 'title'> | undefined): string {
  return document?.title.trim() || 'Unbenannt'
}
