import { describe, expect, it } from 'vitest'
import { filterSlashOptions, opensSlashMenu, SLASH_OPTIONS } from './slash'

describe('slash menu (#133)', () => {
  it('opens at the start of a block or after a space, not inside words or URLs', () => {
    expect(opensSlashMenu('/')).toBe(true)
    expect(opensSlashMenu(' /')).toBe(true)
    expect(opensSlashMenu('a/')).toBe(false)
    expect(opensSlashMenu('//')).toBe(false)
  })

  it('filters by label and search terms, German and English', () => {
    expect(filterSlashOptions('')).toEqual(SLASH_OPTIONS)
    expect(filterSlashOptions('über').map((o) => o.key)).toEqual(['h1', 'h2', 'h3'])
    expect(filterSlashOptions('h2').map((o) => o.key)).toEqual(['h2'])
    expect(filterSlashOptions('list').map((o) => o.key)).toEqual(['bullet', 'ordered'])
    expect(filterSlashOptions('todo').map((o) => o.key)).toEqual(['todo'])
    expect(filterSlashOptions('trenn').map((o) => o.key)).toEqual(['divider'])
    expect(filterSlashOptions('code').map((o) => o.key)).toEqual(['code'])
    expect(filterSlashOptions('bild').map((o) => o.key)).toEqual(['file'])
    expect(filterSlashOptions('xyz')).toEqual([])
  })
})
