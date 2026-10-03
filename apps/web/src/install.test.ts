import { describe, expect, it } from 'vitest'
import { isIos, isStandalone } from './install'

const nav = (userAgent: string, platform = '', maxTouchPoints = 0) => ({
  userAgent,
  platform,
  maxTouchPoints,
})

describe('install helpers', () => {
  it('detects iOS including iPadOS that reports a Mac', () => {
    expect(isIos(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))).toBe(true)
    expect(isIos(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5))).toBe(true)
    expect(isIos(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0))).toBe(false)
    expect(isIos(nav('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5))).toBe(false)
  })

  it('knows when it already runs as installed app', () => {
    const media = (standalone: boolean) => () => ({ matches: standalone })
    expect(isStandalone(media(true), {} as Navigator)).toBe(true)
    expect(
      isStandalone(media(false), { standalone: true } as Navigator & { standalone: boolean }),
    ).toBe(true)
    expect(isStandalone(media(false), {} as Navigator)).toBe(false)
  })
})
