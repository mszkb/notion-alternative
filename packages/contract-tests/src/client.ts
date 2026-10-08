/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are plain JSON, checked by the assertions */
import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { inject } from 'vitest'

/** Only HTTP (#118): the same calls work against any server implementation. */
export const PASSWORD = 'correct horse battery staple'

export interface Reply<T = any> {
  status: number
  body: T
  headers: Headers
  raw: Uint8Array
}

export class Client {
  cookie: string | null = null
  readonly base = inject('serverUrl')

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply<T>> {
    const binary = body instanceof Uint8Array
    const response = await fetch(`${this.base}/api${path}`, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined && !binary ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : binary ? (body as BodyInit) : JSON.stringify(body),
    })
    const session = response.headers.getSetCookie().find((cookie) => cookie.startsWith('session='))
    if (session) {
      const value = session.split(';')[0]!
      this.cookie = value === 'session=' ? null : value
    }
    const raw = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder().decode(raw)
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // not JSON (attachments, metrics)
    }
    return { status: response.status, body: parsed as T, headers: response.headers, raw }
  }

  get = <T = any>(path: string) => this.request<T>('GET', path)
  post = <T = any>(path: string, body?: unknown) => this.request<T>('POST', path, body)
}

/** A registered user with a workspace and a registered device. */
export class Account extends Client {
  email = `contract-${randomUUID()}@example.com`
  workspaceId = ''
  deviceId = randomUUID()

  static async create(): Promise<Account> {
    const account = new Account()
    const registered = await account.post('/auth/register', {
      email: account.email,
      password: PASSWORD,
    })
    if (registered.status !== 201) throw new Error(`register: ${JSON.stringify(registered.body)}`)
    account.workspaceId = (await account.get('/workspaces')).body.workspaces[0].id
    const device = await account.post('/devices', { id: account.deviceId, name: 'Contract' })
    if (device.status !== 201) throw new Error(`device: ${JSON.stringify(device.body)}`)
    return account
  }

  op(
    entity: Operation['entity'],
    kind: Operation['kind'],
    entityId: string,
    payload: object,
    baseRevision: number | null = null,
    deviceId = this.deviceId,
  ): Operation {
    return {
      opId: randomUUID(),
      deviceId,
      workspaceId: this.workspaceId,
      entity,
      entityId,
      kind,
      baseRevision,
      payload: payload as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    }
  }

  /** Pushes operations and returns the per-operation results. */
  async push(...operations: Operation[]): Promise<any[]> {
    const reply = await this.post('/sync/push', { operations })
    if (reply.status !== 200) throw new Error(`push: ${reply.status} ${JSON.stringify(reply.body)}`)
    return reply.body.results
  }

  /** Creates a page (and optional blocks) and returns their ids. */
  async page(title = 'Seite', blocks: string[] = []) {
    const id = randomUUID()
    const blockIds = blocks.map(() => randomUUID())
    await this.push(
      this.op('document', 'create', id, docPayload(title)),
      ...blocks.map((content, i) =>
        this.op('block', 'create', blockIds[i]!, blockPayload(id, content, `a${i}`)),
      ),
    )
    return { id, blockIds }
  }
}

export const docPayload = (title = 'Seite', parentId: string | null = null, sortKey = 'a0') => ({
  parentId,
  title,
  sortKey,
  favorite: false,
  createdAt: new Date().toISOString(),
})

export const blockPayload = (documentId: string, content = 'Text', sortKey = 'a0') => ({
  documentId,
  type: 'paragraph',
  content,
  attrs: {},
  sortKey,
})

export const errorCode = (reply: Reply) =>
  (reply.body as { error?: { code?: string } })?.error?.code
