import 'fake-indexeddb/auto'
import { newId, type Operation, type SyncPushResult } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceStatus } from '../device'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { connection } from '../session'
import { requestSync, stopSync, syncState, type SyncTransport } from './engine'

const WS = '11111111-1111-4111-8111-111111111111'

let db: LocalDb
let store: LocalStore

beforeEach(async () => {
  db = new LocalDb(`engine-${newId()}`)
  store = await LocalStore.open(db)
  connection.value = 'online'
  deviceStatus.value = 'registered'
})
afterEach(async () => {
  stopSync()
  vi.unstubAllGlobals()
  db.close()
  await db.delete()
})

/** Transport whose push can be held open to observe overlapping runs. */
function transport() {
  let active = 0
  let maxActive = 0
  let release: () => void = () => {}
  let hold = Promise.resolve()
  const t: SyncTransport & {
    maxActive: () => number
    pushes: number
    block: () => void
    unblock: () => void
  } = {
    pushes: 0,
    maxActive: () => maxActive,
    block: () => {
      hold = new Promise((resolve) => (release = resolve))
    },
    unblock: () => release(),
    push: async ({ operations }: { operations: Operation[] }) => {
      t.pushes++
      active++
      maxActive = Math.max(maxActive, active)
      await hold
      active--
      return {
        results: operations.map((op, i): SyncPushResult => ({
          opId: op.opId,
          status: 'applied',
          revision: 1,
          seq: i + 1,
        })),
      }
    },
    pull: async ({ cursor }) => ({ changes: [], cursor, hasMore: false }),
    snapshot: async () => ({ documents: [], blocks: [], tags: [], documentTags: [], cursor: 0 }),
  }
  return t
}

describe('requestSync', () => {
  it('runs one sync at a time and once more for requests made meanwhile', async () => {
    await store.createDocument({ workspaceId: WS, title: 'A' })
    const t = transport()
    t.block()
    const first = requestSync(store, {}, t)
    const second = requestSync(store, {}, t)
    const third = requestSync(store, {}, t)
    t.unblock()
    await Promise.all([first, second, third])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(t.maxActive()).toBe(1)
    expect(t.pushes).toBeLessThanOrEqual(2)
    expect(await store.pendingOperationCount()).toBe(0)
    expect(syncState.value.lastError).toBeNull()
  })

  it('serialises runs of different tabs through Web Locks', async () => {
    // Minimal Web Locks: one holder per name, others wait in order; log what happens.
    const events: string[] = []
    let holder = Promise.resolve()
    let tab = 0
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, fn: () => Promise<void>) => {
          const id = ++tab
          events.push(`request ${id}`)
          const run = holder.then(async () => {
            events.push(`acquire ${id}`)
            await fn()
            events.push(`release ${id}`)
          })
          holder = run
          return run
        },
      },
    })
    await store.createDocument({ workspaceId: WS, title: 'A' })
    const t = transport()
    // A second tab: same database and device, its own module instance and engine state.
    const otherTab = await LocalStore.open(new LocalDb(db.name))
    // A query string gives a fresh module instance, like a second tab.
    const tabModule = `./engine?tab=${2}`
    const other = (await import(/* @vite-ignore */ tabModule)) as typeof import('./engine')
    expect(other.requestSync).not.toBe(requestSync)

    t.block()
    const mine = requestSync(store, {}, t)
    const theirs = other.requestSync(otherTab, {}, t)
    await new Promise((resolve) => setTimeout(resolve, 10))
    t.unblock()
    await Promise.all([mine, theirs])
    expect(events).toEqual([
      'request 1',
      'request 2',
      'acquire 1',
      'release 1',
      'acquire 2',
      'release 2',
    ])
    expect(t.maxActive()).toBe(1)
    other.stopSync()
    otherTab.db.close()
  })

  it('does nothing offline or before the device is registered; local work goes on', async () => {
    await store.createDocument({ workspaceId: WS, title: 'A' })
    const t = transport()
    connection.value = 'offline'
    await requestSync(store, {}, t)
    connection.value = 'online'
    deviceStatus.value = 'unknown'
    await requestSync(store, {}, t)
    expect(t.pushes).toBe(0)
    expect(await store.pendingOperationCount()).toBe(2)
  })
})
