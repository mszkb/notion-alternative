import { describe, expect, it } from 'vitest'
import {
  Client,
  PASSWORD,
  expectStatus,
  login,
  managedServer,
  randomIp,
  signUp,
  uniqueEmail,
} from '../src/client'
import { LIMITS } from '../src/config'
import { startServer } from '../src/server'

const register = (client: Client, email: string, password = PASSWORD) =>
  client.post('/api/auth/register', { email, password })

const loginAs = (client: Client, email: string, password: string) =>
  client.post('/api/auth/login', { email, password })

describe('auth', () => {
  it('registers, creates a default workspace and starts a session', async () => {
    const client = new Client()
    const email = uniqueEmail('Alice')
    const response = await register(client, email)
    expect(response.status).toBe(201)
    expect(response.json().user).toMatchObject({ email: email.toLowerCase() })
    expect(response.json().user.id).toBeTypeOf('string')

    const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('session='))!
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/api')

    const me = await client.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.json().user).toEqual(response.json().user)

    const workspaces = (await client.get('/api/workspaces')).json().workspaces
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].name).toBe('Personal')
  })

  it('reports open registration (ALLOW_REGISTRATION=true)', async () => {
    const status = await new Client().get('/api/auth/status')
    expect(status.status).toBe(200)
    expect(status.json()).toEqual({ registrationOpen: true })
  })

  it('refuses duplicate emails, regardless of case', async () => {
    const email = uniqueEmail('dup')
    expectStatus(await register(new Client(), email), 201)
    const duplicate = await register(new Client(), email.toUpperCase())
    expect(duplicate.status).toBe(409)
    expect(duplicate.json().error.code).toBe('email_taken')
  })

  it('rejects invalid registration input with details', async () => {
    const response = await register(new Client(), 'nope', 'short')
    expect(response.status).toBe(400)
    expect(response.json().error.code).toBe('invalid_input')
    expect(response.json().error.issues.map((i: { path: string }) => i.path)).toEqual([
      'email',
      'password',
    ])
  })

  it('logs in with correct credentials only; unknown accounts look the same', async () => {
    const { email, client } = await signUp({ device: false })
    const wrong = await loginAs(client.fork(), email, 'wrong password')
    expect(wrong.status).toBe(401)
    expect(wrong.json().error.code).toBe('invalid_credentials')

    const unknown = await loginAs(client.fork(), uniqueEmail('nobody'), PASSWORD)
    expect(unknown.status).toBe(401)
    expect(unknown.json()).toEqual(wrong.json())

    const fresh = client.fork()
    const ok = await loginAs(fresh, email.toUpperCase(), PASSWORD)
    expect(ok.status).toBe(200)
    expect(ok.json().user.email).toBe(email)
    expect(fresh.cookie).toMatch(/^session=.+/)
    expect((await fresh.get('/api/auth/me')).status).toBe(200)
  })

  it('invalidates the session on logout', async () => {
    const { client } = await signUp({ device: false })
    const cookie = client.cookie
    const logout = await client.post('/api/auth/logout')
    expect(logout.status).toBe(204)
    expect(client.cookie).toBeNull()
    const me = await client.fork(cookie).get('/api/auth/me')
    expect(me.status).toBe(401)
    expect(me.json().error.code).toBe('unauthorized')
  })

  it('logout works without a session and validates its body', async () => {
    expect((await new Client().post('/api/auth/logout')).status).toBe(204)
    const { client } = await signUp({ device: false })
    expect((await client.post('/api/auth/logout', { removeDevice: 'yes' })).status).toBe(400)
  })

  it('requires authentication for protected routes', async () => {
    const client = new Client()
    expect((await client.get('/api/auth/me')).status).toBe(401)
    expect((await client.get('/api/workspaces')).status).toBe(401)
    const forged = await client.fork('session=forged').get('/api/workspaces')
    expect(forged.status).toBe(401)
    expect(forged.json().error.code).toBe('unauthorized')
  })
})

describe('closed registration', () => {
  // Needs a second server with ALLOW_REGISTRATION=false; only possible when the suite starts
  // servers itself (not with SERVER_URL).
  it.skipIf(!managedServer())(
    'allows only the very first account unless enabled',
    async () => {
      const server = await startServer({ ALLOW_REGISTRATION: 'false' })
      try {
        const client = () => new Client(randomIp(), server.url)
        expect((await client().get('/api/auth/status')).json()).toEqual({
          registrationOpen: true,
        })
        expectStatus(await register(client(), uniqueEmail('first')), 201)
        expect((await client().get('/api/auth/status')).json()).toEqual({
          registrationOpen: false,
        })
        const second = await register(client(), uniqueEmail('second'))
        expect(second.status).toBe(403)
        expect(second.json().error.code).toBe('registration_closed')
      } finally {
        await server.stop()
      }
    },
    90_000,
  )
})

describe('login rate limiting (LOGIN_MAX_FAILURES_PER_*)', () => {
  it('blocks an email after too many failures, even with the right password', async () => {
    const { email } = await signUp({ device: false })
    for (let i = 0; i < LIMITS.loginMaxFailuresPerEmail; i++) {
      // Different client addresses: the email limit applies across them.
      expect((await loginAs(new Client(), email, 'wrong password')).status).toBe(401)
    }
    const blocked = await loginAs(new Client(), email.toUpperCase(), PASSWORD)
    expect(blocked.status).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
    expect(blocked.json().error.retryAfter).toBeGreaterThan(0)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('answers the same for unknown accounts', async () => {
    const email = uniqueEmail('nobody')
    const client = new Client()
    for (let i = 0; i < LIMITS.loginMaxFailuresPerEmail; i++) {
      expect((await loginAs(client, email, 'wrong password')).status).toBe(401)
    }
    const blocked = await loginAs(client, email, 'wrong password')
    expect(blocked.status).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
  })

  it('resets the email counter after a successful login', async () => {
    const { email, client } = await signUp({ device: false })
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < LIMITS.loginMaxFailuresPerEmail - 1; i++) {
        expect((await loginAs(new Client(), email, 'wrong password')).status).toBe(401)
      }
      expect((await loginAs(client.fork(), email, PASSWORD)).status).toBe(200)
    }
  })

  it('limits failures per client address, taken from the last proxy hop', async () => {
    const account = await signUp({ device: false })
    const ip = randomIp()
    for (let i = 0; i < LIMITS.loginMaxFailuresPerIp; i++) {
      // A spoofed first hop must not let a client rotate addresses.
      const spoofed = new Client(`${randomIp()}, ${ip}`)
      expect((await loginAs(spoofed, uniqueEmail('guess'), 'wrong password')).status).toBe(401)
    }
    expect((await loginAs(new Client(ip), account.email, PASSWORD)).status).toBe(429)
    // Another client behind the same proxy is unaffected.
    expect((await login(account)).cookie).toMatch(/^session=/)
  })
})

describe('registration rate limiting (REGISTER_MAX_ATTEMPTS_PER_IP)', () => {
  it('limits registration attempts per client address', async () => {
    const ip = randomIp()
    for (let i = 0; i < LIMITS.registerMaxAttemptsPerIp; i++) {
      expect((await register(new Client(ip), uniqueEmail('many'))).status).toBe(201)
    }
    const blocked = await register(new Client(ip), uniqueEmail('many'))
    expect(blocked.status).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
    // Other addresses can still register.
    expect((await register(new Client(), uniqueEmail('other'))).status).toBe(201)
  })
})
