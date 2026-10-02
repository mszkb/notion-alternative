import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, register, type TestApp } from './helpers'

describe('workspaces', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('creates and lists workspaces of the current user', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')

    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { cookie },
      payload: { name: '  Notes  ' },
    })
    expect(created.statusCode).toBe(201)
    const workspace = created.json().workspace
    expect(workspace.name).toBe('Notes')

    const list = await app.inject({ url: '/api/workspaces', headers: { cookie } })
    expect(list.json().workspaces.map((w: { name: string }) => w.name)).toEqual([
      'Personal',
      'Notes',
    ])

    const single = await app.inject({ url: `/api/workspaces/${workspace.id}`, headers: { cookie } })
    expect(single.json().workspace).toEqual(workspace)
  })

  it('enforces workspace boundaries between users', async () => {
    ;({ app } = await createTestApp({ allowRegistration: true }))
    const alice = await register(app, 'alice@example.com')
    const bob = await register(app, 'bob@example.com')

    const aliceWorkspaces = await app.inject({
      url: '/api/workspaces',
      headers: { cookie: alice.cookie },
    })
    const aliceWorkspaceId = aliceWorkspaces.json().workspaces[0].id

    const asBob = await app.inject({
      url: `/api/workspaces/${aliceWorkspaceId}`,
      headers: { cookie: bob.cookie },
    })
    expect(asBob.statusCode).toBe(404)

    const bobList = await app.inject({ url: '/api/workspaces', headers: { cookie: bob.cookie } })
    expect(bobList.json().workspaces.map((w: { id: string }) => w.id)).not.toContain(
      aliceWorkspaceId,
    )
  })

  it('validates input and ids', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const empty = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { cookie },
      payload: { name: '   ' },
    })
    expect(empty.statusCode).toBe(400)
    const badId = await app.inject({ url: '/api/workspaces/not-a-uuid', headers: { cookie } })
    expect(badId.statusCode).toBe(400)
  })
})
