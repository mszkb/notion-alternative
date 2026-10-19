import { type Document, newId } from '@notion-alt/shared'
import { Dexie, type Table } from 'dexie'
import { LOCAL_AREA, LocalDb, localDbName } from './db'
import { LocalStore, TAKEOVER_META_KEY, type TakeoverPage } from './store'

/**
 * Takeover of the local area without an account on login (ADR 0023): its pages are written with
 * their ids into a workspace of the account through the `LocalStore`, the normal sync sends them.
 */

const STATE_KEY = TAKEOVER_META_KEY

/** One takeover step at a time across the tabs of this browser (Web Locks). */
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks) return run()
  return locks.request('notion-alt-takeover', run) as Promise<T>
}

/** Progress in `meta` of the local area; set before the first page is written. */
export interface TakeoverState {
  userId: string
  workspaceId: string
  /** New parent page "Von diesem Gerät (TT.MM.JJJJ)" in an existing workspace, else null. */
  parentId: string | null
  parentTitle: string | null
  startedAt: string
  /** New ids for the rare ids the account already holds elsewhere (lower case). */
  remap: Record<string, string>
  /** All pages are written to the account's database; the local area waits for the server. */
  completedAt?: string
}

/** Opens the local area if this browser has one; never creates it. */
export async function openLocalArea(): Promise<LocalStore | null> {
  const name = localDbName(LOCAL_AREA)
  if (!(await Dexie.exists(name))) return null
  return LocalStore.open(new LocalDb(name))
}

/** Deletes the local area, e.g. once the server confirmed the takeover. */
export async function discardLocalArea(local: LocalStore | null): Promise<void> {
  local?.db.close()
  await Dexie.delete(localDbName(LOCAL_AREA))
}

export async function readTakeover(local: LocalStore): Promise<TakeoverState | null> {
  const entry = await local.db.meta.get(STATE_KEY)
  return (entry?.value as TakeoverState | undefined) ?? null
}

async function localWorkspaceId(local: LocalStore): Promise<string | null> {
  return (await local.cachedWorkspaces()).find((w) => w.local)?.id ?? null
}

/** Active pages of the local area, parents before their children. */
export async function localPages(local: LocalStore): Promise<Document[]> {
  const workspaceId = await localWorkspaceId(local)
  if (!workspaceId) return []
  const documents = await local.listDocuments(workspaceId)
  const ids = new Set(documents.map((d) => d.id))
  const ordered: Document[] = []
  const visit = (parentId: string | null) => {
    for (const document of documents) {
      const parent = document.parentId && ids.has(document.parentId) ? document.parentId : null
      if (parent !== parentId) continue
      ordered.push(document)
      visit(document.id)
    }
  }
  visit(null)
  return ordered
}

/** "Von diesem Gerät (12.10.2026)": the date keeps several takeovers apart (ADR 0023). */
export function parentPageTitle(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `Von diesem Gerät (${day}.${month}.${date.getFullYear()})`
}

/**
 * Fixes the target before anything is written; from then on the local area is read-only (every
 * tab, see `TAKEOVER_META_KEY`). Ids the account already holds (e.g. a copy of this data imported
 * earlier) get new ids now, stored with the state, so that a resumed takeover uses the same ones
 * and creates nothing twice. A takeover this user already started is continued, e.g. when two
 * tabs start at once; `replace` sets a new target after the old one became read-only.
 */
export async function startTakeover(
  local: LocalStore,
  account: LocalStore,
  target: {
    userId: string
    workspaceId: string
    underParentPage: boolean
    replace?: boolean
    now?: Date
  },
): Promise<TakeoverState> {
  return exclusive(async () => {
    const existing = await readTakeover(local)
    if (existing?.userId === target.userId && !existing.completedAt && !target.replace) {
      return existing
    }
    const now = target.now ?? new Date()
    const remap: Record<string, string> = {}
    for (const document of await localPages(local)) {
      const page = await readPage(local, document, false)
      const entities = [
        [account.db.documents, [page.document]],
        [account.db.blocks, page.blocks],
        [account.db.tags, page.tags],
        [account.db.documentTags, page.documentTags],
        [account.db.attachments, page.attachments.map((a) => a.attachment)],
      ] as const
      for (const [table, items] of entities) {
        for (const item of items) {
          if (await (table as Table<{ id: string }, string>).get(item.id)) {
            remap[item.id.toLowerCase()] = newId()
          }
        }
      }
    }
    const state: TakeoverState = {
      userId: target.userId,
      workspaceId: target.workspaceId,
      parentId: target.underParentPage ? newId() : null,
      parentTitle: target.underParentPage ? parentPageTitle(now) : null,
      startedAt: now.toISOString(),
      remap,
    }
    await local.db.transaction('rw', local.db.meta, local.db.workspaces, async () => {
      await local.db.meta.put({ key: STATE_KEY, value: state })
      // Shown read-only from now on; the pages live on in the account.
      await local.db.workspaces.filter((w) => !!w.local).modify({ role: 'reader' })
    })
    return state
  })
}

/** A page with its active blocks, tags and attachments (contents only with `withData`). */
async function readPage(
  local: LocalStore,
  document: Document,
  withData = true,
): Promise<TakeoverPage> {
  const blocks = await local.listBlocks(document.id)
  const documentTags = (
    await local.db.documentTags.where('documentId').equals(document.id).toArray()
  ).filter((assignment) => !assignment.deletedAt)
  const tags = await local.tagsForDocument(document.id)
  const attachments = (
    await local.db.attachments.where('documentId').equals(document.id).toArray()
  ).filter((attachment) => !attachment.deletedAt)
  return {
    document,
    blocks,
    tags,
    documentTags,
    attachments: await Promise.all(
      attachments.map(async (attachment) => ({
        attachment,
        data: withData ? ((await local.attachmentContent(attachment.id))?.data ?? null) : null,
      })),
    ),
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Applies the new ids to ids, references, page links and covers; contents stay as they are. */
function remapPage(page: TakeoverPage, remap: Record<string, string>): TakeoverPage {
  if (Object.keys(remap).length === 0) return page
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(UUID, (id) => remap[id.toLowerCase()] ?? id)
    if (value instanceof ArrayBuffer || value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(rewrite)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
  }
  return rewrite(page) as TakeoverPage
}

/**
 * Writes every page not taken over yet, one transaction per page; safe to run again after an
 * interruption. Runs in one tab at a time (Web Locks). Marks the state complete at the end.
 */
export async function runTakeover(
  local: LocalStore,
  account: LocalStore,
  state: TakeoverState,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<number> {
  const run = async () => {
    if (state.parentId && state.parentTitle && !(await account.getDocument(state.parentId))) {
      await account.createDocument({
        id: state.parentId,
        workspaceId: state.workspaceId,
        title: state.parentTitle,
      })
    }
    const pages = await localPages(local)
    let done = 0
    onProgress(done, pages.length)
    for (const document of pages) {
      const page = remapPage(await readPage(local, document), state.remap)
      await account.takeOverPage(page, state.workspaceId, state.parentId)
      onProgress(++done, pages.length)
    }
    const completed: TakeoverState = { ...state, completedAt: new Date().toISOString() }
    await local.db.meta.put({ key: STATE_KEY, value: completed })
    return pages.length
  }
  return exclusive(run)
}

/**
 * Whether the server confirmed everything taken over (every entity has a revision, every
 * attachment is uploaded). Only then may the local area be deleted (ADR 0023).
 */
export async function takeoverConfirmed(
  local: LocalStore,
  account: LocalStore,
  state: TakeoverState,
): Promise<boolean> {
  if (!state.completedAt) return false
  const confirmed = (entity: { revision: number | null } | undefined) =>
    !!entity && entity.revision !== null
  if (state.parentId && !confirmed(await account.getDocument(state.parentId))) return false
  const tags = await account.db.tags.where('workspaceId').equals(state.workspaceId).toArray()
  for (const document of await localPages(local)) {
    const page = remapPage(await readPage(local, document, false), state.remap)
    if (!confirmed(await account.db.documents.get(page.document.id))) return false
    for (const block of page.blocks) {
      if (!confirmed(await account.db.blocks.get(block.id))) return false
    }
    for (const assignment of page.documentTags) {
      if (!confirmed(await account.db.documentTags.get(assignment.id))) return false
    }
    for (const tag of page.tags) {
      const name = tag.name.toLocaleLowerCase()
      if (!tags.some((t) => t.name.toLocaleLowerCase() === name && confirmed(t))) return false
    }
    for (const { attachment } of page.attachments) {
      if (!confirmed(await account.db.attachments.get(attachment.id))) return false
      if ((await account.attachmentContent(attachment.id))?.uploaded === false) return false
    }
  }
  return true
}

/** What to do with the local area after this user signed in (ADR 0023). */
export type TakeoverPlan =
  /** No local area, or nothing in it: nothing to take over. */
  | { kind: 'none' }
  /** Started earlier for this user: continue with the same target. */
  | { kind: 'resume'; state: TakeoverState }
  /** Written completely; waits for the server before the local area is deleted. */
  | { kind: 'waiting'; state: TakeoverState }
  /** Pages to take over; the target is still open. */
  | { kind: 'start'; pages: number }

export async function planTakeover(
  local: LocalStore | null,
  userId: string,
): Promise<TakeoverPlan> {
  if (!local) return { kind: 'none' }
  const state = await readTakeover(local)
  // The first account that completes the takeover gets the pages (ADR 0023).
  if (state?.userId === userId) {
    return state.completedAt ? { kind: 'waiting', state } : { kind: 'resume', state }
  }
  if (state?.completedAt) return { kind: 'none' }
  const pages = (await localPages(local)).length
  return pages === 0 ? { kind: 'none' } : { kind: 'start', pages }
}

/**
 * The target when nobody needs to be asked (ADR 0023): the account has no pages yet (e.g. just
 * registered, with its empty "Personal"), so the pages go to its own oldest editable workspace.
 * Null when the account has pages: the user chooses.
 */
export async function targetWithoutAsking(
  account: LocalStore,
  userId: string,
): Promise<string | null> {
  const workspaces = (await account.cachedWorkspaces()).filter((w) => !w.local && !w.revoked)
  for (const workspace of workspaces) {
    if ((await account.listDocuments(workspace.id)).length > 0) return null
  }
  return workspaces.find((w) => w.ownerId === userId && !account.isReadOnly(w.id))?.id ?? null
}

/** Users whose local area was checked in this session (see `takeoverNeeded`). */
const checked = new Set<string>()

/**
 * Whether the signed-in user must see the takeover first. Cleans up on the way: an empty local
 * area is discarded, a confirmed one deleted. Checked once per session, unless pending.
 */
export async function takeoverNeeded(userId: string, account: LocalStore): Promise<boolean> {
  if (checked.has(userId)) return false
  const local = await openLocalArea()
  const plan = await planTakeover(local, userId)
  if (plan.kind === 'resume' || plan.kind === 'start') {
    local?.db.close()
    return true
  }
  checked.add(userId)
  const discard =
    plan.kind === 'none'
      ? !!local && !(await readTakeover(local))
      : await takeoverConfirmed(local!, account, plan.state)
  if (discard) await discardLocalArea(local)
  else local?.db.close()
  return false
}

/**
 * Before working without an account again: once the server confirmed the takeover, the local
 * area starts anew and empty (ADR 0023). Until then it stays as a read-only backup that can be
 * exported. Repeats the login check afterwards.
 */
export async function prepareLocalArea(): Promise<void> {
  checked.clear()
  const local = await openLocalArea()
  if (!local) return
  const state = await readTakeover(local)
  let confirmed = false
  if (state?.completedAt && (await Dexie.exists(localDbName(state.userId)))) {
    const account = await LocalStore.open(new LocalDb(localDbName(state.userId)))
    try {
      confirmed = await takeoverConfirmed(local, account, state)
    } finally {
      account.db.close()
    }
  }
  if (confirmed) await discardLocalArea(local)
  else local.db.close()
}
