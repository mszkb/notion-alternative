// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connection } from '../session'
import { startSyncTriggers } from './triggers'

const options = { intervalMs: 300_000, checkMs: 60_000, afterChangeMs: 1500 }

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('startSyncTriggers (T-OFF-06: sync without Web Push)', () => {
  let stop: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
    connection.value = 'online'
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('runs on start, focus, online and when the tab becomes visible', () => {
    const run = vi.fn(async () => {})
    ;({ stop } = startSyncTriggers(run, options))
    expect(run).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('runs every five minutes only while visible, sooner while the server is unreachable', () => {
    const run = vi.fn(async () => {})
    ;({ stop } = startSyncTriggers(run, options))
    vi.advanceTimersByTime(240_000)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(run).toHaveBeenCalledTimes(2)

    setVisibility('hidden')
    vi.advanceTimersByTime(600_000)
    expect(run).toHaveBeenCalledTimes(2)

    setVisibility('visible')
    connection.value = 'offline'
    vi.advanceTimersByTime(60_000)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('debounces local changes into one light run', () => {
    const run = vi.fn(async () => {})
    const light = vi.fn(async () => {})
    const triggers = startSyncTriggers(run, options, light)
    stop = triggers.stop
    triggers.changed()
    vi.advanceTimersByTime(1000)
    triggers.changed()
    vi.advanceTimersByTime(1499)
    expect(light).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(light).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('stops all triggers', () => {
    const run = vi.fn(async () => {})
    ;({ stop } = startSyncTriggers(run, options))
    stop()
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(600_000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
