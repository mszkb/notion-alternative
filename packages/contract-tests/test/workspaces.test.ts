import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Client, signUp } from '../src/client'

describe('workspaces', () => {
  it('creates and lists workspaces of the current user', async () => {
    const { client, workspaceId, user } = await signUp({ device: false })

    const created = await client.post('/api/workspaces', { name: '  Notes  ' })
    expect(created.status).toBe(201)
    const workspace = created.json().workspace
    expect(workspace).toMatchObject({ name: 'Notes' })
    expect(workspace.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(workspace.createdAt).toBeTypeOf('string')
    expect(workspace.ownerId).toBe(user.id)

    const list = (await client.get('/api/workspaces')).json().workspaces
    expect(list.map((w: { name: string }) => w.name)).toEqual(['Personal', 'Notes'])
    expect(list[0].id).toBe(workspaceId)

    const single = await client.get(`/api/workspaces/${workspace.id}`)
    expect(single.status).toBe(200)
    expect(single.json().workspace).toEqual(workspace)
  })

  it('enforces workspace boundaries between users', async () => {
    const alice = await signUp({ name: 'alice', device: false })
    const bob = await signUp({ name: 'bob', device: false })

    const asBob = await bob.client.get(`/api/workspaces/${alice.workspaceId}`)
    expect(asBob.status).toBe(404)
    expect(asBob.json().error.code).toBe('not_found')
    const bobList = (await bob.client.get('/api/workspaces')).json().workspaces
    expect(bobList.map((w: { id: string }) => w.id)).not.toContain(alice.workspaceId)
    expect((await alice.client.get(`/api/workspaces/${randomUUID()}`)).status).toBe(404)
  })

  it('validates input and ids, and requires a session', async () => {
    const { client } = await signUp({ device: false })
    const empty = await client.post('/api/workspaces', { name: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.json().error.code).toBe('invalid_input')
    const badId = await client.get('/api/workspaces/not-a-uuid')
    expect(badId.status).toBe(400)
    expect(badId.json().error.code).toBe('invalid_input')
    expect((await new Client().post('/api/workspaces', { name: 'x' })).status).toBe(401)
    expect((await new Client().get(`/api/workspaces/${randomUUID()}`)).status).toBe(401)
  })
})
