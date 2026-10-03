import { afterEach, describe, expect, it } from 'vitest'
import { AttemptLimiter } from '../src/auth/rate-limit'
import { loadConfig } from '../src/config'
import { PASSWORD, createTestApp, register, type TestApp } from './helpers'

const baseLimits = loadConfig({}).authRateLimit

function login(app: TestApp, email: string, password: string, clientIp = '203.0.113.1') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
    // nginx appends the real client address as the last hop.
    headers: { 'x-forwarded-for': clientIp },
  })
}

describe('login rate limiting', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('blocks an email after too many failures, even with the right password', async () => {
    ;({ app } = await createTestApp({
      authRateLimit: { ...baseLimits, loginMaxFailuresPerEmail: 3 },
    }))
    await register(app, 'alice@example.com')

    for (let i = 0; i < 3; i++) {
      // Different client IPs: the email limit must apply across addresses.
      expect((await login(app, 'alice@example.com', 'wrong', `198.51.100.${i}`)).statusCode).toBe(
        401,
      )
    }
    const blocked = await login(app, 'ALICE@example.com', PASSWORD)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('answers the same for unknown accounts', async () => {
    ;({ app } = await createTestApp({
      authRateLimit: { ...baseLimits, loginMaxFailuresPerEmail: 2 },
    }))
    await login(app, 'nobody@example.com', 'wrong')
    await login(app, 'nobody@example.com', 'wrong')
    const blocked = await login(app, 'nobody@example.com', 'wrong')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
  })

  it('resets the email counter after a successful login', async () => {
    ;({ app } = await createTestApp({
      authRateLimit: { ...baseLimits, loginMaxFailuresPerEmail: 2 },
    }))
    await register(app, 'alice@example.com')
    await login(app, 'alice@example.com', 'wrong')
    expect((await login(app, 'alice@example.com', PASSWORD)).statusCode).toBe(200)
    await login(app, 'alice@example.com', 'wrong')
    expect((await login(app, 'alice@example.com', PASSWORD)).statusCode).toBe(200)
  })

  it('limits failures per client IP across emails, using the proxy-provided address', async () => {
    ;({ app } = await createTestApp({
      authRateLimit: { ...baseLimits, loginMaxFailuresPerIp: 3 },
    }))
    await register(app, 'alice@example.com')
    for (let i = 0; i < 3; i++) {
      // A spoofed first hop must not let the attacker rotate addresses.
      await login(app, `user${i}@example.com`, 'wrong', `10.0.0.${i}, 203.0.113.9`)
    }
    expect((await login(app, 'alice@example.com', PASSWORD, '203.0.113.9')).statusCode).toBe(429)
    // Another client behind the same proxy is unaffected.
    expect((await login(app, 'alice@example.com', PASSWORD, '203.0.113.10')).statusCode).toBe(200)
  })
})

describe('registration rate limiting', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('limits registration attempts per client IP', async () => {
    ;({ app } = await createTestApp({
      allowRegistration: true,
      authRateLimit: { ...baseLimits, registerMaxAttemptsPerIp: 2 },
    }))
    const attempt = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: PASSWORD },
        headers: { 'x-forwarded-for': '203.0.113.5' },
      })
    expect((await attempt('a@example.com')).statusCode).toBe(201)
    expect((await attempt('b@example.com')).statusCode).toBe(201)
    expect((await attempt('c@example.com')).statusCode).toBe(429)
  })
})

describe('AttemptLimiter', () => {
  it('unblocks after the window', () => {
    let now = 0
    const limiter = new AttemptLimiter(2, 60_000, () => now)
    limiter.record('k')
    expect(limiter.retryAfter('k')).toBe(0)
    limiter.record('k')
    expect(limiter.retryAfter('k')).toBe(60)
    now = 30_000
    expect(limiter.retryAfter('k')).toBe(30)
    now = 60_000
    expect(limiter.retryAfter('k')).toBe(0)
    limiter.record('k')
    expect(limiter.retryAfter('k')).toBe(0)
  })
})

describe('trusted proxy addresses', () => {
  it('only trusts proxies on private networks', async () => {
    const { isPrivateAddress } = await import('../src/app')
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.18.0.2',
      '192.168.1.5',
      '::1',
      '::ffff:172.20.0.4',
      'fd00::1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1', '::ffff:1.2.3.4', 'garbage']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})
