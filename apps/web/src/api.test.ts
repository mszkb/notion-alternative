import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('api client', () => {
  it('sends JSON to same-origin /api paths', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { user: { id: '1' } }))
    const api = createApi(fetchMock)
    await api.login({ email: 'a@example.com', password: 'x' })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
    })
  })

  it('maps error responses to ApiError', async () => {
    const api = createApi(async () =>
      jsonResponse(401, { error: { code: 'invalid_credentials', message: 'Invalid' } }),
    )
    const error = await api.login({ email: 'a@example.com', password: 'x' }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: 'invalid_credentials' })
  })

  it('handles empty 204 responses', async () => {
    const api = createApi(async () => new Response(null, { status: 204 }))
    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('handles non-JSON error bodies', async () => {
    const api = createApi(async () => new Response('Bad Gateway', { status: 502 }))
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: 'unknown' })
  })
})
