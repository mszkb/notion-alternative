import { afterEach, describe, expect, it, vi } from 'vitest'

describe('date format (#198)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('formats in German without seconds', async () => {
    const { formatDateTime, formatTime } = await import('./format')
    const at = new Date(2026, 9, 13, 9, 46, 46)
    expect(formatDateTime(at)).toBe('13.10.2026, 09:46')
    expect(formatDateTime(at.toISOString())).toBe('13.10.2026, 09:46')
    expect(formatTime(at)).toBe('09:46')
  })

  it('ignores a US browser locale', async () => {
    const Native = Intl.DateTimeFormat
    // The browser's default locale is used only when none is passed.
    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return new Native(locales ?? 'en-US', options)
      },
    })
    const { formatDateTime } = await import('./format')
    const at = new Date(2026, 9, 13, 21, 5, 0)
    expect(new Intl.DateTimeFormat().format(at)).toBe('10/13/2026')
    expect(formatDateTime(at)).toBe('13.10.2026, 21:05')
  })
})
