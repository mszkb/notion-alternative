// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { initTheme, setTheme, themePreference, toggleTheme } from './theme'

describe('theme (#131)', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('follows the system by default and remembers a manual choice', () => {
    initTheme()
    expect(themePreference.value).toBe('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()

    setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    delete document.documentElement.dataset.theme
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    setTheme('system')
    expect(localStorage.getItem('notion-alt.theme')).toBeNull()
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('toggles between light and dark', () => {
    setTheme('light')
    toggleTheme()
    expect(themePreference.value).toBe('dark')
    toggleTheme()
    expect(themePreference.value).toBe('light')
  })
})
