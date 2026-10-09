import type { WorkspaceRole } from '@notion-alt/shared'

/** Roles as the interface names them (ADR 0014). */
export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  reader: 'Lesen',
  commenter: 'Kommentieren',
  editor: 'Bearbeiten',
  owner: 'Besitzer',
}

/** Why the server refused a change, in the words of the interface. */
export function rejectionReason(code: string, message?: string): string {
  switch (code) {
    case 'forbidden':
      return 'Deine Rolle in diesem Workspace erlaubt keine Änderungen'
    case 'workspace_not_found':
      return 'Kein Zugriff mehr auf diesen Workspace'
    case 'quota_exceeded':
      return 'Speicherplatz des Workspace erschöpft'
    case 'too_large':
      return 'Datei zu groß'
    default:
      return message || 'Vom Server abgelehnt'
  }
}
