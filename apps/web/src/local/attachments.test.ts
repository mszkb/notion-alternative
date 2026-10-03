import 'fake-indexeddb/auto'
import {
  type Change,
  newId,
  type Operation,
  type SyncPushResult,
  validateOperationPayload,
} from '@notion-alt/shared'
import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { uploadPendingAttachments } from '../sync/engine'
import { pushQueue } from '../sync/push'
import { LocalDb } from './db'
import { LocalStore, sha256Hex } from './store'

const WS = '11111111-1111-4111-8111-111111111111'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer

let dbs: LocalDb[] = []
async function device() {
  const db = new LocalDb(`attachments-${newId()}`)
  dbs.push(db)
  return LocalStore.open(db)
}
afterEach(async () => {
  for (const db of dbs) {
    db.close()
    await db.delete()
  }
  dbs = []
})

/** Server stand-in that confirms everything and records the change log. */
function server() {
  const log: Change[] = []
  return {
    log,
    push: async ({ operations }: { operations: Operation[] }) => ({
      results: operations.map((op): SyncPushResult => {
        log.push({
          seq: log.length + 1,
          opId: op.opId,
          deviceId: op.deviceId,
          entity: op.entity,
          entityId: op.entityId,
          kind: op.kind,
          revision: 1 + log.filter((c) => c.entityId === op.entityId).length,
          payload: op.payload,
          appliedAt: new Date().toISOString(),
        })
        return { opId: op.opId, status: 'applied', revision: 1, seq: log.length }
      }),
    }),
  }
}

let a: LocalStore
beforeEach(async () => {
  a = await device()
})

async function attach(
  store: LocalStore,
  documentId: string,
  name: string,
  type: string,
  data = PNG,
) {
  return store.addAttachment(documentId, { name, type, data, sha256: await sha256Hex(data) })
}

describe('attachments on this device', () => {
  it('adds an image or file block and queues valid operations', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Anhänge' })
    const image = await attach(a, doc.id, 'foto.png', 'image/png')
    const file = await attach(a, doc.id, 'bericht.pdf', 'application/pdf')
    const evil = await attach(a, doc.id, 'x.svg', 'image/svg+xml')

    expect(image.block).toMatchObject({
      type: 'image',
      attrs: { attachmentId: image.attachment.id },
    })
    expect(file.block).toMatchObject({ type: 'file', content: 'bericht.pdf' })
    expect(evil.block.type).toBe('file')
    expect(image.attachment).toMatchObject({ size: 7, revision: null })
    expect(image.attachment.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await a.attachmentContent(image.attachment.id))?.uploaded).toBe(false)

    for (const op of await a.pendingOperations()) {
      expect(validateOperationPayload(op.entity, op.kind, op.payload), op.entity).toBeNull()
    }
  })

  it('uploads only after the server confirmed the metadata', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Upload' })
    const { attachment } = await attach(a, doc.id, 'foto.png', 'image/png')
    const uploads: string[] = []
    const upload = async (id: string) => {
      uploads.push(id)
      return 'stored' as const
    }
    expect(await uploadPendingAttachments(a, upload)).toBe(0)

    await pushQueue(a, server().push)
    expect(await uploadPendingAttachments(a, upload)).toBe(1)
    expect(uploads).toEqual([attachment.id])
    expect(await uploadPendingAttachments(a, upload)).toBe(0)
  })

  it('replicates metadata and deletion to another device', async () => {
    const remote = server()
    const doc = await a.createDocument({ workspaceId: WS, title: 'Geteilt' })
    const { attachment } = await attach(a, doc.id, 'foto.png', 'image/png')
    await pushQueue(a, remote.push)

    const b = await device()
    await b.applyRemoteChanges(WS, remote.log, remote.log.length)
    expect(await b.getAttachment(attachment.id)).toMatchObject({ name: 'foto.png', size: 7 })
    expect(await b.attachmentContent(attachment.id)).toBeUndefined()
    await b.cacheAttachmentContent(attachment.id, PNG)

    await a.deleteAttachment(attachment.id)
    expect((await a.getAttachment(attachment.id))?.deletedAt).not.toBeNull()
    expect(await a.attachmentContent(attachment.id)).toBeUndefined()
    const before = remote.log.length
    await pushQueue(a, remote.push)
    await b.applyRemoteChanges(WS, remote.log.slice(before), remote.log.length)
    expect((await b.getAttachment(attachment.id))?.deletedAt).not.toBeNull()
    expect(await b.attachmentContent(attachment.id)).toBeUndefined()
  })
})

describe('local schema upgrade to version 3 (T-MIG-02)', () => {
  it('keeps pages, queue and conflicts', async () => {
    const name = `upgrade3-${newId()}`
    const v2 = new Dexie(name)
    const v1Stores = {
      meta: 'key',
      workspaces: 'id',
      documents: 'id, workspaceId, parentId, updatedAt',
      blocks: 'id, documentId',
      tags: 'id, workspaceId',
      documentTags: 'id, documentId, tagId, workspaceId',
      operations: '++seq, &opId, entityId, workspaceId',
      links: 'blockId, documentId, workspaceId, *targets',
    }
    v2.version(1).stores(v1Stores)
    v2.version(2).stores({ conflicts: 'id, workspaceId, documentId, entityId' })
    await v2.table('documents').put({ id: 'd1', workspaceId: WS, title: 'Alt' })
    await v2.table('operations').add({ opId: 'o1', entityId: 'd1', workspaceId: WS })
    await v2.table('conflicts').put({ id: 'c1', workspaceId: WS })
    v2.close()

    const upgraded = new LocalDb(name)
    expect((await upgraded.documents.get('d1'))?.title).toBe('Alt')
    expect(await upgraded.operations.count()).toBe(1)
    expect(await upgraded.conflicts.count()).toBe(1)
    expect(await upgraded.attachments.count()).toBe(0)
    upgraded.close()
    await Dexie.delete(name)
  })
})
