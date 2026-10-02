import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './helpers'

describe('health', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('reports liveness and readiness', async () => {
    ;({ app } = await createTestApp())
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok' })
    const ready = await app.inject('/api/ready')
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({ status: 'ok', checks: { database: 'ok' } })
  })

  it('returns JSON 404 for unknown routes', async () => {
    ;({ app } = await createTestApp())
    const response = await app.inject('/api/nope')
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })
})

describe('proxy trust', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('takes the client IP only from the hop added by the frontend proxy', async () => {
    ;({ app } = await createTestApp())
    app.get('/api/test-ip', async (request) => ({ ip: request.ip }))
    // nginx appends the real client IP to whatever the client sent.
    const response = await app.inject({
      url: '/api/test-ip',
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
    })
    expect(response.json().ip).toBe('203.0.113.7')
  })
})
