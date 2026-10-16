import 'fake-indexeddb/auto'
import {
  newId,
  operationSchema,
  validateOperationPayload,
  type Workspace,
} from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Dexie } from 'dexie'
import { LOCAL_AREA, LocalDb, localDbName } from './db'
import { LocalStore, ReadOnlyWorkspaceError } from './store'
import {
  parentPageTitle,
  prepareLocalArea,
  planTakeover,
  readTakeover,
  runTakeover,
  startTakeover,
  takeoverConfirmed,
  takeoverNeeded,
  targetWithoutAsking,
} from './takeover'

const USER = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

let local: LocalStore
let account: LocalStore
let localWs: string

function workspace(id: string, role: Workspace['role'] = 'owner'): Workspace {
  return {
    id,
    name: id === TARGET ? 'Personal' : 'Andere',
    ownerId: USER,
    createdAt: '2026-01-01T00:00:00.000Z',
    role,
  }
}

beforeEach(async () => {
  local = await LocalStore.open(new LocalDb(`local-${newId()}`))
  account = await LocalStore.open(new LocalDb(`account-${newId()}`))
  localWs = (await local.ensureLocalWorkspace()).id
  await account.cacheWorkspaces([workspace(TARGET), workspace(OTHER)])
})

afterEach(async () => {
  for (const store of [local, account]) {
    store.db.close()
    await store.db.delete()
  }
})

/** A small local area: a page with a sub-page, a link, a tag, an image as block and cover. */
async function fillLocalArea() {
  const parent = await local.createDocument({ workspaceId: localWs, title: 'Notizen' })
  const child = await local.createDocument({
    workspaceId: localWs,
    parentId: parent.id,
    title: 'Unterseite',
  })
  await local.setFavorite(parent.id, true)
  await local.setPageLook(parent.id, { icon: '📝' })
  const [first] = await local.listBlocks(parent.id)
  await local.updateBlock(first!.id, { content: `Siehe [Unterseite](page:${child.id})` })
  await local.addTag(parent.id, 'Arbeit')
  const data = new Uint8Array([1, 2, 3]).buffer
  const file = { name: 'bild.png', type: 'image/png', data, sha256: 'a'.repeat(64) }
  const { attachment } = await local.addAttachment(parent.id, file)
  const cover = await local.setCoverImage(child.id, { ...file, name: 'cover.png' })
  const trashed = await local.createDocument({ workspaceId: localWs, title: 'Im Papierkorb' })
  await local.deleteDocument(trashed.id)
  return { parent, child, attachment, cover, trashed }
}

async function takeOver(underParentPage = false, workspaceId = TARGET) {
  const state = await startTakeover(local, account, { userId: USER, workspaceId, underParentPage })
  return { state, count: await runTakeover(local, account, state) }
}

/** Confirms every queued operation as the server would. */
async function acknowledgeAll() {
  const queued = await account.pendingOperations()
  await account.acknowledge(
    queued.map((op) => ({ opId: op.opId, status: 'applied', revision: 1, seq: 1 })),
  )
}

describe('takeover of the local area on login (ADR 0023)', () => {
  it('writes pages, blocks, tags and attachments with their ids and queues valid operations', async () => {
    const { parent, child, attachment, cover, trashed } = await fillLocalArea()

    const { count } = await takeOver()

    expect(count).toBe(2)
    const pages = await account.listDocuments(TARGET)
    expect(pages.map((d) => d.id).sort()).toEqual([parent.id, child.id].sort())
    const taken = (await account.getDocument(parent.id))!
    expect(taken).toMatchObject({ parentId: null, favorite: true, icon: '📝', revision: null })
    expect(taken.sortKey).toBe(parent.sortKey)
    expect((await account.getDocument(child.id))!.parentId).toBe(parent.id)
    expect((await account.getDocument(child.id))!.cover).toBe(`attachment:${cover.id}`)
    expect(await account.getDocument(trashed.id)).toBeUndefined()
    expect((await account.listBlocks(parent.id)).map((b) => b.content)).toContain(
      `Siehe [Unterseite](page:${child.id})`,
    )
    expect(await account.backlinks(child.id)).toEqual([expect.objectContaining({ id: parent.id })])
    expect((await account.tagsForDocument(parent.id)).map((t) => t.name)).toEqual(['Arbeit'])
    expect(await account.attachmentContent(attachment.id)).toMatchObject({ uploaded: false })

    const ops = await account.pendingOperations()
    for (const op of ops) {
      expect(operationSchema.parse(op).workspaceId).toBe(TARGET)
      expect(op.deviceId).toBe(account.deviceId)
      expect(validateOperationPayload(op.entity, op.kind, op.payload)).toBeNull()
    }
    expect(new Set(ops.map((op) => op.opId)).size).toBe(ops.length)
    // The server checks a cover against existing attachments (#136): attachment before cover.
    const order = ops.map((op) => `${op.entity}:${op.kind}:${op.entityId}`)
    expect(order.indexOf(`attachment:create:${cover.id}`)).toBeLessThan(
      order.indexOf(`document:update:${child.id}`),
    )
    // Search index: the taken-over pages are marked (#98).
    expect(await account.searchDirtyMarks(TARGET)).toEqual(
      new Map([
        [parent.id, expect.any(String)],
        [child.id, expect.any(String)],
      ]),
    )
  })

  it('puts the pages below a dated parent page in an existing workspace and reuses tags by name', async () => {
    const { parent } = await fillLocalArea()
    const existing = await account.createDocument({ workspaceId: TARGET, title: 'Schon da' })
    await account.addTag(existing.id, 'ARBEIT')

    const { state } = await takeOver(true)

    expect(state.parentTitle).toBe(parentPageTitle(new Date()))
    const holder = (await account.getDocument(state.parentId!))!
    expect(holder).toMatchObject({ title: state.parentTitle, parentId: null, workspaceId: TARGET })
    expect((await account.getDocument(parent.id))!.parentId).toBe(holder.id)
    expect((await account.listTags(TARGET)).map((t) => t.name)).toEqual(['ARBEIT'])
    expect((await account.tagsForDocument(parent.id)).map((t) => t.name)).toEqual(['ARBEIT'])
    // Existing content stays as it was.
    expect((await account.getDocument(existing.id))!.parentId).toBeNull()
  })

  it('continues an interrupted takeover without creating anything twice', async () => {
    await fillLocalArea()
    const once = await LocalStore.open(new LocalDb(`once-${newId()}`))
    await once.cacheWorkspaces([workspace(TARGET)])
    const reference = await startTakeover(local, once, {
      userId: USER,
      workspaceId: TARGET,
      underParentPage: true,
    })
    await runTakeover(local, once, reference)
    const expected = (await once.pendingOperations()).length
    once.db.close()
    await once.db.delete()

    const state = await startTakeover(local, account, {
      userId: USER,
      workspaceId: TARGET,
      underParentPage: true,
    })
    // Tab closed after the first page.
    await expect(
      runTakeover(local, account, state, (done) => {
        if (done === 1) throw new Error('tab closed')
      }),
    ).rejects.toThrow('tab closed')
    expect(await account.listDocuments(TARGET)).toHaveLength(2)

    const resumed = await planTakeover(local, USER)
    expect(resumed).toEqual({ kind: 'resume', state: await readTakeover(local) })
    await runTakeover(local, account, (resumed as { state: typeof state }).state)

    expect(await account.listDocuments(TARGET)).toHaveLength(3)
    expect(await account.pendingOperations()).toHaveLength(expected)
  })

  it('gives new ids to ids the account already holds and rewrites page links', async () => {
    const { parent, child } = await fillLocalArea()
    // A copy of the same page, e.g. imported earlier into another workspace.
    await account.takeOverPage(
      {
        document: { ...child, workspaceId: OTHER },
        blocks: [],
        tags: [],
        documentTags: [],
        attachments: [],
      },
      OTHER,
      null,
    )

    const { state } = await takeOver()

    const newChildId = state.remap[child.id]!
    expect(newChildId).toBeDefined()
    expect((await account.getDocument(newChildId))!).toMatchObject({
      workspaceId: TARGET,
      parentId: parent.id,
      title: 'Unterseite',
    })
    expect((await account.getDocument(child.id))!.workspaceId).toBe(OTHER)
    expect((await account.listBlocks(parent.id))[0]!.content).toBe(
      `Siehe [Unterseite](page:${newChildId})`,
    )
  })

  it('writes nothing into a workspace this account may only read', async () => {
    await fillLocalArea()
    await account.cacheWorkspaces([workspace(TARGET, 'reader')])

    await expect(takeOver()).rejects.toThrow(ReadOnlyWorkspaceError)

    expect(await account.listDocuments(TARGET)).toEqual([])
    expect(await account.pendingOperations()).toEqual([])
    expect((await readTakeover(local))!.completedAt).toBeUndefined()
  })

  it('counts as confirmed only after the server accepted everything and attachments are uploaded', async () => {
    const { attachment, cover } = await fillLocalArea()
    const { state } = await takeOver(true)
    const completed = (await readTakeover(local))!
    expect(completed.completedAt).toBeDefined()
    expect(await takeoverConfirmed(local, account, state)).toBe(false)

    await acknowledgeAll()
    expect(await takeoverConfirmed(local, account, completed)).toBe(false)

    await account.markUploaded(attachment.id)
    await account.markUploaded(cover.id)
    expect(await takeoverConfirmed(local, account, completed)).toBe(true)
  })

  it('stays unconfirmed while the server refuses a change (e.g. storage quota)', async () => {
    const { attachment } = await fillLocalArea()
    await takeOver()
    const queued = await account.pendingOperations()
    await account.acknowledge(
      queued.map((op) =>
        op.entityId === attachment.id
          ? { opId: op.opId, status: 'rejected', code: 'quota_exceeded', message: 'full', seq: 1 }
          : { opId: op.opId, status: 'applied', revision: 1, seq: 1 },
      ),
    )

    expect(await takeoverConfirmed(local, account, (await readTakeover(local))!)).toBe(false)
    expect(await account.operationsWithIssues()).toHaveLength(1)
  })
})

describe('planTakeover', () => {
  it('has nothing to do without a local area or without pages in it', async () => {
    expect(await planTakeover(null, USER)).toEqual({ kind: 'none' })
    expect(await planTakeover(local, USER)).toEqual({ kind: 'none' })
    const page = await local.createDocument({ workspaceId: localWs, title: 'Weg' })
    await local.deleteDocument(page.id)
    expect(await planTakeover(local, USER)).toEqual({ kind: 'none' })
  })

  it('starts with the number of pages, resumes or waits for the same user', async () => {
    await fillLocalArea()
    expect(await planTakeover(local, USER)).toEqual({ kind: 'start', pages: 2 })

    const state = await startTakeover(local, account, {
      userId: USER,
      workspaceId: TARGET,
      underParentPage: false,
    })
    expect(await planTakeover(local, USER)).toEqual({ kind: 'resume', state })
    // Another account signing in on this browser starts its own takeover.
    expect(await planTakeover(local, newId())).toEqual({ kind: 'start', pages: 2 })

    await runTakeover(local, account, state)
    expect(await planTakeover(local, USER)).toMatchObject({ kind: 'waiting' })
    expect(await planTakeover(local, newId())).toEqual({ kind: 'none' })
  })
})

describe('targetWithoutAsking', () => {
  it('takes the own workspace while the account has no pages, otherwise asks', async () => {
    const shared = { ...workspace(OTHER, 'editor'), ownerId: newId() }
    await account.cacheWorkspaces([shared, workspace(TARGET)])
    expect(await targetWithoutAsking(account, USER)).toBe(TARGET)

    // Pages in any workspace, also one shared with this account: the user chooses.
    await account.createDocument({ workspaceId: OTHER, title: 'Geteilt' })
    expect(await targetWithoutAsking(account, USER)).toBeNull()
  })

  it('asks when no own workspace may be written', async () => {
    await account.cacheWorkspaces([{ ...workspace(OTHER, 'reader'), ownerId: newId() }])
    expect(await targetWithoutAsking(account, USER)).toBeNull()
  })
})

describe('safety of the local area during the takeover (review of #182)', () => {
  it('turns the local area read-only once the takeover starts, also for other tabs', async () => {
    const { parent } = await fillLocalArea()
    // Another tab with its own handle on the same database.
    const otherTab = await LocalStore.open(new LocalDb(local.db.name))

    await startTakeover(local, account, {
      userId: USER,
      workspaceId: TARGET,
      underParentPage: false,
    })

    await expect(otherTab.renameDocument(parent.id, 'Später')).rejects.toThrow(
      ReadOnlyWorkspaceError,
    )
    await expect(local.createDocument({ workspaceId: localWs, title: 'Neu' })).rejects.toThrow(
      ReadOnlyWorkspaceError,
    )
    expect((await local.cachedWorkspaces())[0]).toMatchObject({ local: true, role: 'reader' })
    otherTab.db.close()
  })

  it('continues a started takeover instead of starting a second one, unless replaced', async () => {
    await fillLocalArea()
    const target = { userId: USER, workspaceId: TARGET, underParentPage: true }
    const first = await startTakeover(local, account, target)

    expect(await startTakeover(local, account, target)).toEqual(first)

    const replaced = await startTakeover(local, account, {
      ...target,
      workspaceId: OTHER,
      replace: true,
    })
    expect(replaced.workspaceId).toBe(OTHER)
    expect(replaced.parentId).not.toBe(first.parentId)
  })

  it('moves to another target after the first became read-only, without losing pages', async () => {
    const { parent, child } = await fillLocalArea()
    await account.cacheWorkspaces([workspace(TARGET, 'reader'), workspace(OTHER)])
    const state = await startTakeover(local, account, {
      userId: USER,
      workspaceId: TARGET,
      underParentPage: true,
    })
    await expect(runTakeover(local, account, state)).rejects.toThrow(ReadOnlyWorkspaceError)

    const next = await startTakeover(local, account, {
      userId: USER,
      workspaceId: OTHER,
      underParentPage: true,
      replace: true,
    })
    await runTakeover(local, account, next)

    const titles = (await account.listDocuments(OTHER)).map((d) => d.title).sort()
    expect(titles).toEqual(['Notizen', 'Unterseite', next.parentTitle].sort())
    expect((await account.getDocument(parent.id))!.workspaceId).toBe(OTHER)
    expect((await account.getDocument(child.id))!.parentId).toBe(parent.id)
  })

  it('puts a page whose parent did not come along below the target', async () => {
    const { child } = await fillLocalArea()
    // Old data: the parent is gone without the page.
    await local.db.documents.update(child.id, { parentId: newId() })

    await takeOver()

    expect((await account.getDocument(child.id))!.parentId).toBeNull()
  })

  it('assigns a tag once when two local tags differ only in case', async () => {
    const { parent } = await fillLocalArea()
    const tag = {
      id: newId(),
      workspaceId: localWs,
      name: 'arbeit',
      revision: null,
      deletedAt: null,
    }
    await local.db.tags.add(tag)
    await local.db.documentTags.add({
      id: newId(),
      workspaceId: localWs,
      documentId: parent.id,
      tagId: tag.id,
      revision: null,
      deletedAt: null,
    })

    await takeOver()

    expect(await account.db.documentTags.where('documentId').equals(parent.id).count()).toBe(1)
  })
})

describe('deleting the local area (the databases this browser really uses)', () => {
  let area: LocalStore
  let own: LocalStore

  beforeEach(async () => {
    area = await LocalStore.open(new LocalDb(localDbName(LOCAL_AREA)))
    own = await LocalStore.open(new LocalDb(localDbName(USER)))
    await own.cacheWorkspaces([workspace(TARGET)])
    const ws = (await area.ensureLocalWorkspace()).id
    await area.createDocument({ workspaceId: ws, title: 'Lokal' })
  })

  afterEach(async () => {
    for (const store of [area, own]) store.db.close()
    await Dexie.delete(localDbName(LOCAL_AREA))
    await Dexie.delete(localDbName(USER))
  })

  async function completeTakeover() {
    const state = await startTakeover(area, own, {
      userId: USER,
      workspaceId: TARGET,
      underParentPage: false,
    })
    await runTakeover(area, own, state)
  }

  it('keeps the local area as a backup until the server confirmed everything', async () => {
    await completeTakeover()
    area.db.close()

    await prepareLocalArea()
    expect(await Dexie.exists(localDbName(LOCAL_AREA))).toBe(true)
    expect(await takeoverNeeded(USER, own)).toBe(false)
    expect(await Dexie.exists(localDbName(LOCAL_AREA))).toBe(true)

    const queued = await own.pendingOperations()
    await own.acknowledge(
      queued.map((op) => ({ opId: op.opId, status: 'applied', revision: 1, seq: 1 })),
    )
    await prepareLocalArea()
    expect(await Dexie.exists(localDbName(LOCAL_AREA))).toBe(false)
  })

  it('asks for the takeover while pages wait, and drops an empty local area', async () => {
    expect(await takeoverNeeded(USER, own)).toBe(true)
    await area.deleteDocument(
      (await area.listDocuments((await area.cachedWorkspaces())[0]!.id))[0]!.id,
    )
    area.db.close()

    await prepareLocalArea()
    expect(await takeoverNeeded(USER, own)).toBe(false)
    expect(await Dexie.exists(localDbName(LOCAL_AREA))).toBe(false)
  })
})
