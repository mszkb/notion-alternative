import type {
  AttachmentUsage,
  ChangePasswordInput,
  CreateWorkspaceInput,
  Device,
  DocumentVersion,
  DocumentVersionState,
  ImportInput,
  LoginInput,
  LogoutInput,
  PushSubscriptionInput,
  RegisterDeviceInput,
  RegisterInput,
  ServerSearchHit,
  SyncLogQuery,
  SyncLogResponse,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushInput,
  SyncPushResult,
  SyncDocumentResponse,
  SyncDocumentsResponse,
  SyncSnapshotResponse,
  User,
  Workspace,
} from '@notion-alt/shared'
import { SNAPSHOT_PAGE_SIZE } from '@notion-alt/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Fetch = typeof fetch

export function createApi(fetchImpl: Fetch = (...args) => fetch(...args)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 204) return undefined as T
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const error = data?.error ?? {}
      throw new ApiError(
        response.status,
        error.code ?? 'unknown',
        error.message ?? response.statusText,
      )
    }
    return data as T
  }

  return {
    authStatus: () => request<{ registrationOpen: boolean }>('GET', '/auth/status'),
    register: (input: RegisterInput) => request<{ user: User }>('POST', '/auth/register', input),
    login: (input: LoginInput) => request<{ user: User }>('POST', '/auth/login', input),
    logout: (input: LogoutInput = {}) => request<void>('POST', '/auth/logout', input),
    changePassword: (input: ChangePasswordInput) => request<void>('POST', '/auth/password', input),
    me: () => request<{ user: User }>('GET', '/auth/me'),
    registerDevice: (input: RegisterDeviceInput) =>
      request<{ device: Device }>('POST', '/devices', input),
    listDevices: () => request<{ devices: Device[] }>('GET', '/devices'),
    renameDevice: (id: string, name: string) =>
      request<{ device: Device }>('PATCH', `/devices/${id}`, { name }),
    removeDevice: (id: string) => request<void>('DELETE', `/devices/${id}`),
    syncPush: (input: SyncPushInput) =>
      request<{ results: SyncPushResult[] }>('POST', '/sync/push', input),
    syncPull: ({ workspaceId, cursor, limit }: SyncPullQuery) =>
      request<SyncPullResponse>(
        'GET',
        `/sync/pull?${new URLSearchParams({
          workspaceId,
          cursor: String(cursor),
          limit: String(limit),
        })}`,
      ),
    syncLog: ({ workspaceId, cursor, limit }: SyncLogQuery) =>
      request<SyncLogResponse>(
        'GET',
        `/sync/log?${new URLSearchParams({
          workspaceId,
          cursor: String(cursor),
          limit: String(limit),
        })}`,
      ),
    syncSnapshot: (workspaceId: string, after?: string, content = true) =>
      request<SyncSnapshotResponse>(
        'GET',
        `/sync/snapshot?${new URLSearchParams({
          workspaceId,
          limit: String(SNAPSHOT_PAGE_SIZE),
          ...(after === undefined ? {} : { after }),
          ...(content ? {} : { content: 'false' }),
        })}`,
      ),
    syncDocuments: (workspaceId: string, ids: string[]) =>
      request<SyncDocumentsResponse>('POST', '/sync/documents', { workspaceId, ids }),
    syncDocument: (workspaceId: string, documentId: string) =>
      request<SyncDocumentResponse>(
        'GET',
        `/sync/documents/${encodeURIComponent(documentId)}?${new URLSearchParams({ workspaceId })}`,
      ),
    search: (workspaceId: string, q: string) =>
      request<{ hits: ServerSearchHit[] }>(
        'GET',
        `/search?${new URLSearchParams({ workspaceId, q })}`,
      ),
    pushPublicKey: () => request<{ publicKey: string }>('GET', '/push/public-key'),
    pushSubscribe: (input: PushSubscriptionInput) =>
      request<void>('POST', '/push/subscriptions', input),
    pushUnsubscribe: (endpoint: string) =>
      request<void>('DELETE', '/push/subscriptions', { endpoint }),
    attachmentUsage: (workspaceId: string) =>
      request<AttachmentUsage>('GET', `/attachments/usage?${new URLSearchParams({ workspaceId })}`),
    documentHistory: (documentId: string, workspaceId: string) =>
      request<{ versions: DocumentVersion[] }>(
        'GET',
        `/documents/${documentId}/history?${new URLSearchParams({ workspaceId })}`,
      ),
    documentVersion: (documentId: string, seq: number, workspaceId: string) =>
      request<DocumentVersionState>(
        'GET',
        `/documents/${documentId}/history/${seq}?${new URLSearchParams({ workspaceId })}`,
      ),
    importWorkspace: (input: ImportInput) =>
      request<{ workspace: Workspace }>('POST', '/import', input),
    listWorkspaces: () => request<{ workspaces: Workspace[] }>('GET', '/workspaces'),
    createWorkspace: (input: CreateWorkspaceInput) =>
      request<{ workspace: Workspace }>('POST', '/workspaces', input),
  }
}

/** Attachment content transfer (binary, outside the JSON API helper). */
export async function uploadAttachment(
  id: string,
  data: ArrayBuffer,
  fetchImpl: Fetch = (...args) => fetch(...args),
): Promise<'stored' | 'gone'> {
  const response = await fetchImpl(`/api/attachments/${id}/content`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: data,
  })
  if (response.status === 204) return 'stored'
  // Deleted meanwhile: nothing left to upload.
  if (response.status === 410) return 'gone'
  const error = (await response.json().catch(() => null))?.error ?? {}
  throw new ApiError(response.status, error.code ?? 'unknown', error.message ?? response.statusText)
}

export async function downloadAttachment(
  id: string,
  fetchImpl: Fetch = (...args) => fetch(...args),
): Promise<ArrayBuffer | null> {
  const response = await fetchImpl(`/api/attachments/${id}/content`, { credentials: 'same-origin' })
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(response.status, 'download_failed', response.statusText)
  return response.arrayBuffer()
}

export const api = createApi()
