import { type AppOptions, buildApp } from '../src/app'
import { loadConfig, type Config } from '../src/config'
import { createDatabase } from '../src/db/database'
import { migrateToLatest } from '../src/db/migrate'

export async function createTestApp(
  overrides: Partial<Config> = {},
  options: Pick<AppOptions, 'push' | 'contentStore'> = {},
) {
  const config = { ...loadConfig({}), databasePath: ':memory:', ...overrides }
  const db = createDatabase(config.databasePath)
  await migrateToLatest(db)
  const app = await buildApp({ db, config, ...options })
  return { app, db, config }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']

export const PASSWORD = 'correct horse battery staple'

/** Extracts the "name=value" pair of the session cookie from a response. */
export function sessionCookie(response: { cookies: { name: string; value: string }[] }): string {
  const cookie = response.cookies.find((c) => c.name === 'session')
  if (!cookie) throw new Error('no session cookie in response')
  return `session=${cookie.value}`
}

export async function register(app: TestApp, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: PASSWORD },
  })
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`)
  return { response, cookie: sessionCookie(response) }
}
