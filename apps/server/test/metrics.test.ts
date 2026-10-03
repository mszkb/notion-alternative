import { afterEach, describe, expect, it } from 'vitest'
import { Registry } from '../src/metrics/registry'
import { createTestApp, register, type TestApp } from './helpers'

describe('metrics endpoint', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('is not available unless enabled', async () => {
    ;({ app } = await createTestApp())
    expect((await app.inject('/api/metrics')).statusCode).toBe(404)
  })

  it('exposes Prometheus text with route templates instead of concrete paths', async () => {
    ;({ app } = await createTestApp({ metricsEnabled: true }))
    const { cookie } = await register(app, 'metrics@example.com')
    const list = await app.inject({ url: '/api/workspaces', headers: { cookie } })
    const id = list.json().workspaces[0].id as string
    await app.inject({ url: `/api/workspaces/${id}`, headers: { cookie } })
    await app.inject('/api/does-not-exist')

    const response = await app.inject('/api/metrics')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain; version=0.0.4')
    const body = response.body

    expect(body).toContain('# TYPE http_requests_total counter')
    expect(body).toContain(
      'http_requests_total{method="POST",route="/api/auth/register",status="201"} 1',
    )
    expect(body).toContain('route="/api/workspaces/:id"')
    expect(body).toContain('route="unmatched"')
    expect(body).toContain('# TYPE http_request_duration_seconds histogram')
    expect(body).toMatch(/process_resident_memory_bytes \d+/)
    expect(body).toContain('nodejs_eventloop_lag_seconds{quantile="0.99"}')
    // No concrete IDs or personal data in labels.
    expect(body).not.toContain(id)
    expect(body).not.toContain('metrics@example.com')
  })
})

describe('registry', () => {
  it('renders counters, gauges and cumulative histogram buckets', () => {
    const registry = new Registry()
    registry.counter('ops_total', 'Ops.').inc({ kind: 'a"b' }, 2)
    registry.gauge('temp', 'Temp.').set(1.5)
    const h = registry.histogram('lat', 'Latency.', [0.1, 1])
    h.observe({}, 0.05)
    h.observe({}, 0.5)
    h.observe({}, 5)

    const text = registry.render()
    expect(text).toContain('ops_total{kind="a\\"b"} 2')
    expect(text).toContain('temp 1.5')
    expect(text).toContain('lat_bucket{le="0.1"} 1')
    expect(text).toContain('lat_bucket{le="1"} 2')
    expect(text).toContain('lat_bucket{le="+Inf"} 3')
    expect(text).toContain('lat_count 3')
    expect(() => registry.counter('ops_total', 'dup')).toThrow()
  })
})
