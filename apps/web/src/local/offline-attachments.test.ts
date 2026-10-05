import 'fake-indexeddb/auto'
import { type Attachment, newId } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from './db'
import { downloadAllAttachments, type OfflineAttachmentsProgress } from './offline-attachments'
import { LocalStore, sha256Hex } from './store'

const WS = '11111111-1111-4111-8111-111111111111'

let db: LocalDb
let store: LocalStore
beforeEach(async () => {
  db = new LocalDb(`offline-${newId()}`)
  store = await LocalStore.open(db)
})
afterEach(async () => {
  db.close()
  await db.delete()
})

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

/** Metadata as it arrives by sync from another device; the content is only on the server. */
async function remote(name: string, content: string, extra: Partial<Attachment> = {}) {
  const data = bytes(content)
  const attachment: Attachment = {
    id: newId(),
    workspaceId: WS,
    documentId: newId(),
    name,
    mimeType: 'application/pdf',
    size: data.byteLength,
    sha256: await sha256Hex(data),
    createdAt: '2026-10-05T00:00:00.000Z',
    revision: 1,
    deletedAt: null,
    ...extra,
  }
  await db.attachments.put(attachment)
  return { attachment, data }
}

describe('downloadAllAttachments', () => {
  it('downloads what is missing, checks it and reports progress', async () => {
    const a = await remote('a.pdf', 'Inhalt A')
    const b = await remote('b.pdf', 'Inhalt B, etwas länger')
    const here = await remote('schon-da.pdf', 'lokal')
    await store.cacheAttachmentContent(here.attachment.id, here.data)
    await remote('gelöscht.pdf', 'weg', { deletedAt: '2026-10-05T00:00:00.000Z' })
    const server = new Map([
      [a.attachment.id, a.data],
      [b.attachment.id, b.data],
    ])
    const requested: string[] = []
    const progress: OfflineAttachmentsProgress[] = []

    const result = await downloadAllAttachments(store, {
      download: async (id) => {
        requested.push(id)
        return server.get(id) ?? null
      },
      onProgress: (p) => progress.push(p),
    })

    expect(result).toEqual({ downloaded: 2, unavailable: 0, failed: 0, stopped: null })
    expect(requested.sort()).toEqual([a.attachment.id, b.attachment.id].sort())
    expect(progress.map((p) => p.done)).toEqual([0, 1, 2])
    expect(progress.at(-1)).toMatchObject({
      total: 2,
      bytes: a.data.byteLength + b.data.byteLength,
      totalBytes: a.data.byteLength + b.data.byteLength,
    })
    expect((await store.attachmentsOnDevice()).every((e) => e.local)).toBe(true)
    // A second run has nothing left to do.
    expect(await downloadAllAttachments(store, { download: async () => null })).toEqual({
      downloaded: 0,
      unavailable: 0,
      failed: 0,
      stopped: null,
    })
  })

  it('keeps nothing that does not match the checksum and counts content not uploaded yet', async () => {
    const wrong = await remote('falsch.pdf', 'echt')
    const pending = await remote('noch-nicht-hochgeladen.pdf', 'später')
    const result = await downloadAllAttachments(store, {
      download: async (id) => (id === wrong.attachment.id ? bytes('fals') : null),
    })
    expect(result).toEqual({ downloaded: 0, unavailable: 1, failed: 1, stopped: null })
    expect(await store.attachmentContent(wrong.attachment.id)).toBeUndefined()
    expect(await store.attachmentContent(pending.attachment.id)).toBeUndefined()
  })

  it('stops on connection loss and on cancel, keeping what was downloaded', async () => {
    const first = await remote('1.pdf', 'eins')
    await remote('2.pdf', 'zwei')
    await remote('3.pdf', 'drei')
    let calls = 0
    const offline = await downloadAllAttachments(store, {
      download: async (id) => {
        if (++calls > 1) throw new TypeError('Failed to fetch')
        return id === first.attachment.id ? first.data : null
      },
    })
    expect(offline.stopped).toBe('offline')
    expect(offline.downloaded + offline.unavailable).toBe(1)

    const controller = new AbortController()
    const cancelled = await downloadAllAttachments(store, {
      download: async () => {
        controller.abort()
        return null
      },
      signal: controller.signal,
    })
    expect(cancelled.stopped).toBe('cancelled')
    expect(cancelled.unavailable).toBe(1)
  })

  it('stops when the storage is full', async () => {
    const a = await remote('a.pdf', 'A')
    await remote('b.pdf', 'B')
    store.cacheAttachmentContent = async () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    const result = await downloadAllAttachments(store, {
      download: async () => a.data,
    })
    expect(result.stopped).toBe('quota')
    expect(result.downloaded).toBe(0)
  })
})
