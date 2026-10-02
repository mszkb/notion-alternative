import { afterEach, describe, expect, it } from 'vitest'
import { PASSWORD, createTestApp, type TestApp } from './helpers'

describe('concurrent registration', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('creates only one account when registration is closed after the first user', async () => {
    ;({ app } = await createTestApp())
    const responses = await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) =>
        app.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: { email: `${name}@example.com`, password: PASSWORD },
        }),
      ),
    )
    const codes = responses.map((r) => r.statusCode).sort()
    expect(codes).toEqual([201, 403, 403, 403])
  })
})
