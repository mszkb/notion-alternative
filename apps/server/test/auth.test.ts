import { afterEach, describe, expect, it } from 'vitest'
import { PASSWORD, createTestApp, register, sessionCookie, type TestApp } from './helpers'

describe('auth', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('registers the first user, creates a default workspace and starts a session', async () => {
    ;({ app } = await createTestApp())
    const { response, cookie } = await register(app, 'Alice@Example.com')
    expect(response.json().user.email).toBe('alice@example.com')

    const setCookie = String(response.headers['set-cookie'])
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')

    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.email).toBe('alice@example.com')

    const workspaces = await app.inject({ url: '/api/workspaces', headers: { cookie } })
    expect(workspaces.json().workspaces).toHaveLength(1)
  })

  it('closes registration after the first user unless enabled', async () => {
    ;({ app } = await createTestApp())
    await register(app, 'alice@example.com')
    expect((await app.inject('/api/auth/status')).json()).toEqual({ registrationOpen: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@example.com', password: PASSWORD },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('registration_closed')
  })

  it('allows further registrations when enabled, but not duplicate emails', async () => {
    ;({ app } = await createTestApp({ allowRegistration: true }))
    await register(app, 'alice@example.com')
    await register(app, 'bob@example.com')
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'ALICE@example.com', password: PASSWORD },
    })
    expect(duplicate.statusCode).toBe(409)
  })

  it('rejects invalid registration input with details', async () => {
    ;({ app } = await createTestApp())
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'nope', password: 'short' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('invalid_input')
    expect(response.json().error.issues.map((i: { path: string }) => i.path)).toEqual([
      'email',
      'password',
    ])
  })

  it('logs in with correct credentials only', async () => {
    ;({ app } = await createTestApp())
    await register(app, 'alice@example.com')

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: 'wrong password' },
    })
    expect(wrong.statusCode).toBe(401)

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: PASSWORD },
    })
    expect(unknown.statusCode).toBe(401)
    expect(unknown.json()).toEqual(wrong.json())

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: PASSWORD },
    })
    expect(ok.statusCode).toBe(200)
    expect(sessionCookie(ok)).toMatch(/^session=.+/)
  })

  it('invalidates the session on logout', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(logout.statusCode).toBe(204)
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(401)
  })

  it('rejects expired sessions', async () => {
    let db
    ;({ app, db } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    await db.updateTable('sessions').set({ expires_at: new Date(0).toISOString() }).execute()
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(401)
  })

  it('requires authentication for protected routes', async () => {
    ;({ app } = await createTestApp())
    expect((await app.inject('/api/auth/me')).statusCode).toBe(401)
    expect((await app.inject('/api/workspaces')).statusCode).toBe(401)
    const forged = await app.inject({ url: '/api/workspaces', headers: { cookie: 'session=forged' } })
    expect(forged.statusCode).toBe(401)
  })
})
