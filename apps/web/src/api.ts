import type {
  ChangePasswordInput,
  CreateWorkspaceInput,
  Device,
  LoginInput,
  RegisterDeviceInput,
  RegisterInput,
  SyncPushInput,
  SyncPushResult,
  User,
  Workspace,
} from '@notion-alt/shared'

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
    logout: () => request<void>('POST', '/auth/logout'),
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
    listWorkspaces: () => request<{ workspaces: Workspace[] }>('GET', '/workspaces'),
    createWorkspace: (input: CreateWorkspaceInput) =>
      request<{ workspace: Workspace }>('POST', '/workspaces', input),
  }
}

export const api = createApi()
