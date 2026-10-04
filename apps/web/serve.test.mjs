import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFrontendServer, readSecurityHeaders } from './serve.mjs'

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
}

describe('frontend server without Docker', () => {
  let root
  let backend
  let frontend
  let url
  const backendRequests = []

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'serve-test-'))
    mkdirSync(path.join(root, 'assets'))
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>app</title>')
    writeFileSync(path.join(root, 'assets', 'app-123.js'), 'console.log(1)')
    writeFileSync(path.join(root, 'sw.js'), 'self')
    writeFileSync(path.join(root, 'manifest.webmanifest'), '{}')
    writeFileSync(path.join(tmpdir(), 'serve-test-secret.txt'), 'secret')

    backend = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        backendRequests.push({ method: req.method, url: req.url, headers: req.headers, body })
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    })
    const backendUrl = await listen(backend)
    frontend = createFrontendServer({ root, backend: backendUrl })
    url = await listen(frontend)
  })

  afterAll(() => {
    frontend.close()
    backend.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(path.join(tmpdir(), 'serve-test-secret.txt'), { force: true })
  })

  it('serves index.html for app routes without caching it', async () => {
    const res = await fetch(`${url}/pages/abc`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toContain('<title>app</title>')
  })

  it('caches hashed assets forever and revalidates the service worker and manifest', async () => {
    const asset = await fetch(`${url}/assets/app-123.js`)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(asset.headers.get('content-type')).toContain('text/javascript')

    const sw = await fetch(`${url}/sw.js`)
    expect(sw.headers.get('cache-control')).toBe('no-cache')

    const manifest = await fetch(`${url}/manifest.webmanifest`)
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json')
  })

  it('answers missing assets with 404 instead of the SPA', async () => {
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404)
  })

  it('sets the same security headers as nginx', async () => {
    const res = await fetch(`${url}/`)
    for (const [name, value] of Object.entries(readSecurityHeaders()))
      expect(res.headers.get(name)).toBe(value)
  })

  it('never serves files outside the build directory', async () => {
    const res = await fetch(`${url}/..%2Fserve-test-secret.txt`)
    expect(await res.text()).not.toContain('secret')
  })

  it('proxies /api with body, method and forwarded headers', async () => {
    const res = await fetch(`${url}/api/pages?x=1`, { method: 'POST', body: 'hello' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const request = backendRequests.at(-1)
    expect(request).toMatchObject({ method: 'POST', url: '/api/pages?x=1', body: 'hello' })
    expect(request.headers['x-forwarded-for']).toBe('127.0.0.1')
    expect(request.headers['x-forwarded-proto']).toBe('http')
  })

  it('hides the metrics endpoint', async () => {
    const before = backendRequests.length
    expect((await fetch(`${url}/api/metrics`)).status).toBe(404)
    expect(backendRequests.length).toBe(before)
  })

  it('answers 502 when the backend is down', async () => {
    const offline = createFrontendServer({ root, backend: 'http://127.0.0.1:1' })
    const offlineUrl = await listen(offline)
    try {
      expect((await fetch(`${offlineUrl}/api/health`)).status).toBe(502)
    } finally {
      offline.close()
    }
  })

  it('reports health', async () => {
    expect(await (await fetch(`${url}/healthz`)).text()).toBe('ok\n')
  })
})
