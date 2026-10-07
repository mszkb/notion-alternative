import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Account, Client, errorCode, PASSWORD } from './client'

describe('health', () => {
  it('answers /health and /ready', async () => {
    const client = new Client()
    expect((await client.get('/health')).body).toEqual({ status: 'ok' })
    const ready = await client.get('/ready')
    expect(ready.status).toBe(200)
    expect(ready.body.status).toBe('ok')
  })
})

describe('auth', () => {
  it('registers, reads the session, logs out and in again', async () => {
    const client = new Client()
    expect((await client.get('/auth/status')).body).toEqual({ registrationOpen: true })
    const email = `contract-${randomUUID()}@example.com`
    const registered = await client.post('/auth/register', { email, password: PASSWORD })
    expect(registered.status).toBe(201)
    expect(registered.body.user.email).toBe(email)
    expect(client.cookie).toMatch(/^session=/)
    expect((await client.get('/auth/me')).body.user.email).toBe(email)

    expect((await client.post('/auth/logout', {})).status).toBe(204)
    expect((await client.get('/auth/me')).status).toBe(401)

    const login = await client.post('/auth/login', { email, password: PASSWORD })
    expect(login.status).toBe(200)
    expect((await client.get('/auth/me')).status).toBe(200)
  })

  it('refuses wrong passwords, duplicates, invalid input and missing sessions', async () => {
    const account = await Account.create()
    const client = new Client()
    const wrong = await client.post('/auth/login', {
      email: account.email,
      password: 'falsch-falsch',
    })
    expect(wrong.status).toBe(401)
    expect(errorCode(wrong)).toBe('invalid_credentials')
    const duplicate = await client.post('/auth/register', {
      email: account.email,
      password: PASSWORD,
    })
    expect(duplicate.status).toBe(409)
    const invalid = await client.post('/auth/register', { email: 'kein-mail', password: 'x' })
    expect(invalid.status).toBe(400)
    expect(errorCode(invalid)).toBe('invalid_input')
    expect((await client.get('/workspaces')).status).toBe(401)
  })

  it('changes the password and ends other sessions', async () => {
    const account = await Account.create()
    const other = new Client()
    await other.post('/auth/login', { email: account.email, password: PASSWORD })

    const wrong = await account.post('/auth/password', {
      currentPassword: 'nicht richtig',
      newPassword: 'ein ganz neues passwort',
    })
    expect(wrong.status).toBe(400)
    const changed = await account.post('/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'ein ganz neues passwort',
    })
    expect(changed.status).toBe(204)
    expect((await account.get('/auth/me')).status).toBe(200)
    expect((await other.get('/auth/me')).status).toBe(401)
    const login = await new Client().post('/auth/login', {
      email: account.email,
      password: 'ein ganz neues passwort',
    })
    expect(login.status).toBe(200)
  })
})

describe('workspaces and devices', () => {
  it('lists, creates and reads workspaces, only the own ones', async () => {
    const account = await Account.create()
    const created = await account.post('/workspaces', { name: 'Zweiter' })
    expect(created.status).toBe(201)
    const id = created.body.workspace.id
    expect((await account.get('/workspaces')).body.workspaces).toHaveLength(2)
    expect((await account.get(`/workspaces/${id}`)).body.workspace.name).toBe('Zweiter')
    const stranger = await Account.create()
    expect((await stranger.get(`/workspaces/${id}`)).status).toBe(404)
    expect((await account.post('/workspaces', { name: '' })).status).toBe(400)
  })

  it('registers, renames and removes devices; a removed device cannot push', async () => {
    const account = await Account.create()
    const devices = (await account.get('/devices')).body.devices
    expect(devices.map((d: { id: string }) => d.id)).toContain(account.deviceId)
    const renamed = await account.request('PATCH', `/devices/${account.deviceId}`, {
      name: 'Laptop',
    })
    expect(renamed.body.device.name).toBe('Laptop')
    expect((await account.request('PATCH', `/devices/${randomUUID()}`, { name: 'x' })).status).toBe(
      404,
    )

    // The current device cannot remove itself; another one can be removed.
    expect((await account.request('DELETE', `/devices/${account.deviceId}`)).status).toBe(409)
    const phone = randomUUID()
    const other = new Client()
    await other.post('/auth/login', { email: account.email, password: PASSWORD })
    await other.post('/devices', { id: phone, name: 'Telefon' })
    expect((await account.request('DELETE', `/devices/${phone}`)).status).toBe(204)
    const pushed = await account.post('/sync/push', {
      operations: [
        account.op(
          'document',
          'create',
          randomUUID(),
          {
            parentId: null,
            title: 'x',
            sortKey: 'a0',
            favorite: false,
            createdAt: 'x',
          },
          null,
          phone,
        ),
      ],
    })
    expect(pushed.status).toBe(200)
    expect(pushed.body.results[0]).toMatchObject({ status: 'rejected', code: 'device_not_active' })
  })
})
