import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { closeLocalStore, localStore, openLocalStore, workspaces } from './context'

describe('openLocalStore', () => {
  it('drops an open that was superseded by close (logout or user switch)', async () => {
    const pending = openLocalStore('11111111-1111-4111-8111-111111111111')
    closeLocalStore()
    await expect(pending).rejects.toThrow(/superseded/)
    expect(localStore.value).toBeNull()
    expect(workspaces.value).toEqual([])
  })

  it('keeps the newer user when a previous open finishes later', async () => {
    const first = openLocalStore('11111111-1111-4111-8111-111111111111')
    const second = openLocalStore('22222222-2222-4222-8222-222222222222')
    await expect(first).rejects.toThrow(/superseded/)
    const store = await second
    expect(localStore.value).toBe(store)
    expect(store.db.name).toBe('notion-alt-22222222-2222-4222-8222-222222222222')
    closeLocalStore()
  })
})
