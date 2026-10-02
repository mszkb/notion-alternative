import type { Document } from '@notion-alt/shared'
import { inject, type InjectionKey, type Ref } from 'vue'
import type { LocalStore } from '../local/store'

export interface WorkspaceContext {
  store: LocalStore
  workspaceId: Readonly<Ref<string>>
  /** All active documents of the workspace (live). */
  documents: Readonly<Ref<Document[]>>
  documentsById: Readonly<Ref<Map<string, Document>>>
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
