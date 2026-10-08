// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isTextTarget, shortcutFor } from './shortcuts'

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, ctrlKey: true, ...init })

describe('app shortcuts (#134)', () => {
  it('maps Notion shortcuts to commands', () => {
    expect(shortcutFor(key('k'), false)).toBe('palette')
    expect(shortcutFor(key('p'), true)).toBe('palette')
    expect(shortcutFor(key('k', { ctrlKey: false, metaKey: true }), false)).toBe('palette')
    expect(shortcutFor(key('n'), false)).toBe('newPage')
    expect(shortcutFor(key('n', { altKey: true }), false)).toBe('newPage')
    expect(shortcutFor(key('L', { shiftKey: true }), false)).toBe('toggleTheme')
    expect(shortcutFor(key('\\'), false)).toBe('sidebar')
    expect(shortcutFor(key('/'), false)).toBe('shortcuts')
  })

  it('leaves Ctrl/⌘+K in text to the editor and ignores plain keys', () => {
    expect(shortcutFor(key('k'), true)).toBeNull()
    expect(shortcutFor(key('k', { ctrlKey: false }), false)).toBeNull()
    expect(shortcutFor(key('b'), false)).toBeNull()
    const handled = key('p', { cancelable: true })
    handled.preventDefault()
    expect(shortcutFor(handled, false)).toBeNull()
  })

  it('recognises editable targets', () => {
    const block = document.createElement('div')
    block.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    block.append(inner)
    expect(isTextTarget(inner)).toBe(true)
    expect(isTextTarget(document.createElement('input'))).toBe(true)
    expect(isTextTarget(document.createElement('button'))).toBe(false)
    expect(isTextTarget(null)).toBe(false)
  })
})
