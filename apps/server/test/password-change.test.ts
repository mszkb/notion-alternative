import { afterEach, describe, expect, it } from 'vitest'
import { PASSWORD, createTestApp, register, sessionCookie, type TestApp } from './helpers'

const NEW_PASSWORD = 'another long passphrase'

describe('change password', () => {
  let app: TestApp
  afterEach(() => app.close())

  async function login(email: string, password: string) {
    return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  }

  function change(cookie: string, currentPassword: string, newPassword = NEW_PASSWORD) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { currentPassword, newPassword },
    })
  }

  it('requires authentication', async () => {
    ;({ app } = await createTestApp())
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a wrong current password without changing anything', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const response = await change(cookie, 'wrong password')
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('invalid_current_password')
    expect((await login('alice@example.com', PASSWORD)).statusCode).toBe(200)
  })

  it('enforces the password policy for the new password', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const response = await change(cookie, PASSWORD, 'short')
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('invalid_input')
  })

  it('switches the password and ends all other sessions', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const other = sessionCookie(await login('alice@example.com', PASSWORD))

    expect((await change(cookie, PASSWORD)).statusCode).toBe(204)

    expect((await login('alice@example.com', PASSWORD)).statusCode).toBe(401)
    expect((await login('alice@example.com', NEW_PASSWORD)).statusCode).toBe(200)
    const me = (c: string) => app.inject({ url: '/api/auth/me', headers: { cookie: c } })
    expect((await me(cookie)).statusCode).toBe(200)
    expect((await me(other)).statusCode).toBe(401)
  })

  it('counts wrong current passwords towards the login limit', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    for (let i = 0; i < 5; i++) await change(cookie, 'wrong password')
    const blocked = await change(cookie, PASSWORD)
    expect(blocked.statusCode).toBe(429)
    expect((await login('alice@example.com', PASSWORD)).statusCode).toBe(429)
  })
})
