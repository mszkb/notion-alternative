import type { Document, WorkspaceRole } from '@notion-alt/shared'
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
  /** Id of the open page, if any. */
  activeDocumentId: Readonly<Ref<string | null>>
  /** Link to a page of this workspace, without resolving a route per tree node (#102). */
  pageHref: (documentId: string) => string
  /** The user's role; the last known one offline (ADR 0014). */
  role: Readonly<Ref<WorkspaceRole>>
  /** No changes possible here: role below `editor` or access revoked. */
  readOnly: Readonly<Ref<boolean>>
}

/** Shared empty child list: a leaf's computed stays the same value across updates. */
export const NO_CHILDREN: readonly Document[] = Object.freeze([])

/**
 * Groups documents by parent in one pass (#102). Filtering the whole list per tree node was
 * quadratic: 100 million comparisons per update at 10 000 pages. A group whose documents are the
 * same objects as in `previous` keeps its old array, so tree nodes whose children did not change
 * keep the same value.
 */
export function groupByParent(
  documents: Document[],
  previous?: Map<string | null, Document[]>,
): Map<string | null, Document[]> {
  const groups = new Map<string | null, Document[]>()
  for (const document of documents) {
    const list = groups.get(document.parentId)
    if (list) list.push(document)
    else groups.set(document.parentId, [document])
  }
  if (previous) {
    for (const [parentId, list] of groups) {
      const before = previous.get(parentId)
      if (before?.length === list.length && before.every((d, i) => d === list[i])) {
        groups.set(parentId, before)
      }
    }
  }
  return groups
}

/**
 * Keeps the previous object of every unchanged document (#102): a reloaded list then only
 * re-renders the tree nodes whose document really changed. Compares all fields shallowly, so
 * fields added later are covered too.
 */
export function reuseUnchanged(previous: Document[], next: Document[]): Document[] {
  if (previous.length === 0) return next
  const old = new Map(previous.map((d) => [d.id, d]))
  return next.map((d) => {
    const before = old.get(d.id)
    return before && sameFields(before, d) ? before : d
  })
}

function sameFields(a: Document, b: Document): boolean {
  const keys = Object.keys(b) as (keyof Document)[]
  return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key])
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

/** Title with the page icon in front, for the tree, breadcrumbs and lists (#136). */
export function pageLabel(document: Pick<Document, 'title' | 'icon'> | undefined): string {
  const icon = document?.icon
  return icon ? `${icon} ${displayTitle(document)}` : displayTitle(document)
}
