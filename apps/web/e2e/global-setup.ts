import { request } from '@playwright/test'
import { USER } from './fixtures'

/** Registers the test account (the first account may always register). */
export default async function globalSetup() {
  const api = await request.newContext({ baseURL: 'http://localhost:5180' })
  const response = await api.post('/api/auth/register', { data: USER })
  if (!response.ok() && response.status() !== 409 && response.status() !== 403) {
    throw new Error(`Registration failed: ${response.status()} ${await response.text()}`)
  }
  await api.dispose()
}
