import { describe, expect, it } from 'vitest'
import { Client, op, docPayload, push, signUp } from '../src/client'
import { randomUUID } from 'node:crypto'

describe('health', () => {
  it('reports liveness and readiness', async () => {
    const client = new Client()
    const health = await client.get('/api/health')
    expect(health.status).toBe(200)
    expect(health.json()).toEqual({ status: 'ok' })
    const ready = await client.get('/api/ready')
    expect(ready.status).toBe(200)
    expect(ready.json()).toEqual({ status: 'ok', checks: { database: 'ok' } })
  })

  it('returns JSON 404 for unknown routes', async () => {
    const response = await new Client().get('/api/nope')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(response.json().error.code).toBe('not_found')
  })

  it('answers malformed JSON with 400', async () => {
    const response = await new Client().request('POST', '/api/auth/login', {
      body: '{"email":',
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(400)
    expect(response.json().error.code).toBeTypeOf('string')
  })
})

describe('metrics (METRICS_ENABLED=true)', () => {
  it('serves Prometheus text with the sync counters', async (context) => {
    const account = await signUp()
    await push(account, op(account, 'document', 'create', randomUUID(), docPayload()))
    const response = await account.client.get('/api/metrics')
    // Optional for servers without a metrics store (ADR 0018): then the route is missing.
    if (response.status === 404) context.skip()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(response.text()).toMatch(/^sync_push_operations_total\{status="applied"\} \d+$/m)
  })
})
