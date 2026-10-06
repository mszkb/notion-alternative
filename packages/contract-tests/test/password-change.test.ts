import { describe, expect, it } from 'vitest'
import { Client, PASSWORD, login, signUp } from '../src/client'
import { LIMITS } from '../src/config'

const NEW_PASSWORD = 'another long passphrase'

const change = (client: Client, currentPassword: string, newPassword = NEW_PASSWORD) =>
  client.post('/api/auth/password', { currentPassword, newPassword })

const loginAs = (email: string, password: string) =>
  new Client().post('/api/auth/login', { email, password })

describe('POST /api/auth/password', () => {
  it('requires authentication', async () => {
    const response = await change(new Client(), PASSWORD)
    expect(response.status).toBe(401)
  })

  it('rejects a wrong current password without changing anything', async () => {
    const { client, email } = await signUp({ device: false })
    const response = await change(client, 'wrong password')
    expect(response.status).toBe(400)
    expect(response.json().error.code).toBe('invalid_current_password')
    expect((await loginAs(email, PASSWORD)).status).toBe(200)
  })

  it('enforces the password policy for the new password', async () => {
    const { client } = await signUp({ device: false })
    const response = await change(client, PASSWORD, 'short')
    expect(response.status).toBe(400)
    expect(response.json().error.code).toBe('invalid_input')
    expect(response.json().error.issues.map((i: { path: string }) => i.path)).toEqual([
      'newPassword',
    ])
  })

  it('switches the password and ends all other sessions', async () => {
    const account = await signUp({ device: false })
    const other = await login(account)

    expect((await change(account.client, PASSWORD)).status).toBe(204)

    expect((await loginAs(account.email, PASSWORD)).status).toBe(401)
    expect((await loginAs(account.email, NEW_PASSWORD)).status).toBe(200)
    expect((await account.client.get('/api/auth/me')).status).toBe(200)
    expect((await other.get('/api/auth/me')).status).toBe(401)
  })

  it('counts wrong current passwords towards the login limit', async () => {
    const { client, email } = await signUp({ device: false })
    for (let i = 0; i < LIMITS.loginMaxFailuresPerEmail; i++) {
      expect((await change(client, 'wrong password')).status).toBe(400)
    }
    const blocked = await change(client, PASSWORD)
    expect(blocked.status).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
    expect((await loginAs(email, PASSWORD)).status).toBe(429)
  })
})
