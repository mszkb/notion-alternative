// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { shortcutFor } from './shortcuts'

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, ctrlKey: true, ...init })

describe('app shortcuts (#134)', () => {
  it('maps Notion shortcuts to commands', () => {
    expect(shortcutFor(key('k'))).toBe('palette')
    expect(shortcutFor(key('p'))).toBe('palette')
    expect(shortcutFor(key('k', { ctrlKey: false, metaKey: true }))).toBe('palette')
    expect(shortcutFor(key('n'))).toBe('newPage')
    expect(shortcutFor(key('n', { altKey: true }))).toBe('newPage')
    expect(shortcutFor(key('L', { shiftKey: true }))).toBe('toggleTheme')
    expect(shortcutFor(key('\\'))).toBe('sidebar')
    expect(shortcutFor(key('/'))).toBe('shortcuts')
  })

  it('leaves a handled Ctrl/⌘+K (link on selected text, #197) to the editor', () => {
    const handled = key('k', { cancelable: true })
    handled.preventDefault()
    expect(shortcutFor(handled)).toBeNull()
  })

  it('ignores plain keys and keys the editor handled', () => {
    expect(shortcutFor(key('k', { ctrlKey: false }))).toBeNull()
    expect(shortcutFor(key('b'))).toBeNull()
    const handled = key('p', { cancelable: true })
    handled.preventDefault()
    expect(shortcutFor(handled)).toBeNull()
  })
})
