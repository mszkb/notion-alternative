import { describe, expect, it, vi } from 'vitest'
import { ensurePersistentStorage, formatBytes, storageUsage } from './persistence'

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

describe('storage usage', () => {
  it('reports usage and quota and formats bytes', async () => {
    const usage = await storageUsage({ estimate: async () => ({ usage: 12_345_678, quota: 2e9 }) })
    expect(usage).toEqual({ usage: 12_345_678, quota: 2e9 })
    expect(await storageUsage(undefined)).toBeNull()
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(12_345_678)).toBe('12,3 MB')
    expect(formatBytes(2e9)).toBe('2,0 GB')
    expect(formatBytes(150_000_000)).toBe('150 MB')
  })
})
