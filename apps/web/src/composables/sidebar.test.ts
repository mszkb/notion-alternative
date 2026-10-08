// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  setSidebarCollapsed,
  setSidebarWidth,
  sidebarCollapsed,
  sidebarWidth,
} from './sidebar'

describe('sidebar state (#132)', () => {
  it('keeps the width within bounds and remembers it', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH)
    setSidebarWidth(300.4)
    expect(sidebarWidth.value).toBe(300)
    expect(localStorage.getItem('notion-alt.sidebar.width')).toBe('300')
  })

  it('remembers whether it is collapsed', () => {
    setSidebarCollapsed(true)
    expect(sidebarCollapsed.value).toBe(true)
    expect(localStorage.getItem('notion-alt.sidebar.collapsed')).toBe('true')
    setSidebarCollapsed(false)
    expect(localStorage.getItem('notion-alt.sidebar.collapsed')).toBe('false')
  })
})
