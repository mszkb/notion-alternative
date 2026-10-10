import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { readLastUser, readStartMode, resolveSession, writeStartMode } from './session'

const user = { id: '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f', email: 'a@example.com', createdAt: 'x' }
const other = { ...user, id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }

describe('resolveSession', () => {
  it('uses the server user when reachable', async () => {
    expect(await resolveSession(async () => ({ user }), other)).toEqual({
      user,
      connection: 'online',
    })
  })

  it('falls back to the cached user when the server is unreachable (AC-08)', async () => {
    const unreachable = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await resolveSession(unreachable, user)).toEqual({ user, connection: 'offline' })
    const badGateway = async () => {
      throw new ApiError(502, 'unknown', 'Bad Gateway')
    }
    expect(await resolveSession(badGateway, user)).toEqual({ user, connection: 'offline' })
    await expect(resolveSession(unreachable, null)).rejects.toThrow('Failed to fetch')
  })

  it('keeps local access with an expired session', async () => {
    const expired = async () => {
      throw new ApiError(401, 'unauthorized', 'Unauthorized')
    }
    expect(await resolveSession(expired, user)).toEqual({ user, connection: 'expired' })
    expect(await resolveSession(expired, null)).toEqual({ user: null, connection: 'online' })
  })
})

describe('without an account (ADR 0023)', () => {
  const unreachable = async () => {
    throw new TypeError('Failed to fetch')
  }
  const expired = async () => {
    throw new ApiError(401, 'unauthorized', 'Unauthorized')
  }

  it('starts in the local area when nobody is signed in, online or not', async () => {
    for (const me of [unreachable, expired]) {
      expect(await resolveSession(me, null, 'local')).toEqual({ user: null, connection: 'local' })
    }
  })

  it('still finds an existing session or a cached user', async () => {
    expect(await resolveSession(async () => ({ user }), null, 'local')).toEqual({
      user,
      connection: 'online',
    })
    expect(await resolveSession(unreachable, user, 'local')).toEqual({
      user,
      connection: 'offline',
    })
    expect(await resolveSession(expired, user, 'local')).toEqual({ user, connection: 'expired' })
  })

  it('remembers the login as start after signing out; defaults to local', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    } as unknown as Storage
    expect(readStartMode(storage)).toBe('local')
    writeStartMode('login', storage)
    expect(readStartMode(storage)).toBe('login')
    writeStartMode('local', storage)
    expect(readStartMode(storage)).toBe('local')
    expect(readStartMode(undefined)).toBe('local')
  })
})

describe('readLastUser', () => {
  function storage(value: string | null): Storage {
    return { getItem: () => value } as unknown as Storage
  }

  it('reads a valid cached user and ignores garbage', () => {
    expect(readLastUser(storage(JSON.stringify(user)))).toEqual(user)
    expect(readLastUser(storage('{nope'))).toBeNull()
    expect(readLastUser(storage(JSON.stringify({ id: 1 })))).toBeNull()
    expect(readLastUser(undefined)).toBeNull()
  })
})
