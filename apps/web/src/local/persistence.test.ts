import { describe, expect, it, vi } from 'vitest'
import { ensurePersistentStorage } from './persistence'

describe('ensurePersistentStorage', () => {
  it('reports unsupported without the Storage API', async () => {
    expect(await ensurePersistentStorage(undefined)).toBe('unsupported')
  })

  it('does not ask again when already persisted', async () => {
    const persist = vi.fn()
    const status = await ensurePersistentStorage({ persisted: async () => true, persist })
    expect(status).toBe('persisted')
    expect(persist).not.toHaveBeenCalled()
  })

  it('requests persistence and reports a refusal', async () => {
    const persist = vi.fn(async () => false)
    expect(await ensurePersistentStorage({ persisted: async () => false, persist })).toBe(
      'not-persisted',
    )
    expect(persist).toHaveBeenCalledOnce()
  })

  it('only checks when asked not to request', async () => {
    const persist = vi.fn(async () => true)
    expect(await ensurePersistentStorage({ persisted: async () => false, persist }, false)).toBe(
      'not-persisted',
    )
    expect(persist).not.toHaveBeenCalled()
  })
})
