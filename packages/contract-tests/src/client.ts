import { randomBytes, randomUUID } from 'node:crypto'
import type { Operation, SyncPushResult } from '@notion-alt/shared'
import { inject } from 'vitest'

export const PASSWORD = 'correct horse battery staple'

/** Parsed JSON of a response; tests read it like the app does. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are untyped
export type Json = any

export interface Response {
  status: number
  headers: Headers
  body: Buffer
  json: () => Json
  text: () => string
}

export interface RequestOptions {
  /** Sent as JSON. */
  json?: unknown
  /** Raw body (e.g. attachment content). */
  body?: Uint8Array | string
  headers?: Record<string, string>
}

export const serverUrl = () => inject('serverUrl')

/** True if the suite started the server itself; false for SERVER_URL. */
export const managedServer = () => inject('managedServer')

/**
 * A random client address. The server trusts one proxy hop from a private address (the test
 * runner connects from loopback), so `X-Forwarded-For` gives every client its own rate limits.
 */
export function randomIp(): string {
  const [a, b, c] = randomBytes(3)
  return `10.${a}.${b}.${c}`
}

export const uniqueEmail = (name = 'user') => `${name}-${randomUUID()}@example.com`

/** HTTP client with its own session cookie and client address. */
export class Client {
  cookie: string | null = null

  constructor(
    readonly ip: string = randomIp(),
    readonly baseUrl: string = serverUrl(),
  ) {}

  async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip, ...options.headers }
    if (this.cookie) headers.cookie = this.cookie
    let body: string | Buffer | undefined
    if (options.json !== undefined) {
      headers['content-type'] ??= 'application/json'
      body = JSON.stringify(options.json)
    } else if (options.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : Buffer.from(options.body)
    }
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      body,
      redirect: 'manual',
    })
    for (const setCookie of response.headers.getSetCookie()) {
      const match = /^session=([^;]*)/.exec(setCookie)
      if (!match) continue
      const cleared = !match[1] || /expires=thu, 01 jan 1970/i.test(setCookie)
      this.cookie = cleared ? null : `session=${match[1]}`
    }
    const data = Buffer.from(await response.arrayBuffer())
    return {
      status: response.status,
      headers: response.headers,
      body: data,
      json: () => JSON.parse(data.toString()),
      text: () => data.toString(),
    }
  }

  get(path: string, options?: RequestOptions) {
    return this.request('GET', path, options)
  }
  post(path: string, json?: unknown, options: RequestOptions = {}) {
    return this.request('POST', path, { ...options, json })
  }
  put(path: string, options?: RequestOptions) {
    return this.request('PUT', path, options)
  }
  patch(path: string, json?: unknown) {
    return this.request('PATCH', path, { json })
  }
  delete(path: string, json?: unknown) {
    return this.request('DELETE', path, { json })
  }

  /** Same address, but its own session (or none). */
  fork(cookie: string | null = null): Client {
    const client = new Client(this.ip, this.baseUrl)
    client.cookie = cookie
    return client
  }
}

/** Builds a query string from defined values. */
export function query(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  return new URLSearchParams(entries.map(([k, v]): [string, string] => [k, String(v)])).toString()
}

/** Throws with the body if the status differs (clearer than a failing `.json()` later). */
export function expectStatus(response: Response, status: number): Response {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${response.text()}`)
  }
  return response
}

export interface Account {
  client: Client
  email: string
  user: { id: string; email: string }
  /** The default workspace created with the account. */
  workspaceId: string
  /** Device registered with the account's session (empty if `device: false`). */
  deviceId: string
}

/** Registers a fresh account (unique email) with its own client address. */
export async function signUp(options: { name?: string; device?: boolean } = {}): Promise<Account> {
  const client = new Client()
  const email = uniqueEmail(options.name)
  const registered = expectStatus(
    await client.post('/api/auth/register', { email, password: PASSWORD }),
    201,
  )
  const workspaces = expectStatus(await client.get('/api/workspaces'), 200)
  const workspaceId = workspaces.json().workspaces[0].id as string
  let deviceId = ''
  if (options.device ?? true) {
    deviceId = await registerDevice(client)
  }
  return { client, email, user: registered.json().user, workspaceId, deviceId }
}

/** Registers a new device with the client's session; returns its id. */
export async function registerDevice(client: Client, name = 'Test'): Promise<string> {
  const id = randomUUID()
  expectStatus(await client.post('/api/devices', { id, name }), 201)
  return id
}

/** Signs in again: a new session (new client, same address). */
export async function login(account: Pick<Account, 'client' | 'email'>): Promise<Client> {
  const client = account.client.fork()
  expectStatus(
    await client.post('/api/auth/login', { email: account.email, password: PASSWORD }),
    200,
  )
  return client
}

export interface OpTarget {
  workspaceId: string
  deviceId: string
}

export function op(
  target: OpTarget,
  entity: Operation['entity'],
  kind: Operation['kind'],
  entityId: string,
  payload: object = {},
  baseRevision: number | null = null,
  overrides: Partial<Operation> = {},
): Operation {
  return {
    opId: randomUUID(),
    deviceId: target.deviceId,
    workspaceId: target.workspaceId,
    entity,
    entityId,
    kind,
    baseRevision,
    payload: payload as Record<string, unknown>,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export const docPayload = (title = 'Seite', parentId: string | null = null, sortKey = 'a0') => ({
  parentId,
  title,
  sortKey,
  favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
})

export const blockPayload = (
  documentId: string,
  content = 'x',
  type = 'paragraph',
  sortKey = 'a0',
  attrs: object = {},
) => ({ documentId, type, content, attrs, sortKey })

export type PushResult = SyncPushResult & Json

/** `POST /api/sync/push`; returns the per-operation results. */
export async function push(
  account: { client: Client },
  ...operations: Operation[]
): Promise<PushResult[]> {
  const response = expectStatus(await account.client.post('/api/sync/push', { operations }), 200)
  return response.json().results
}
