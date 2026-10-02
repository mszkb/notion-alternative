import { describe, expect, it } from 'vitest'
import { loginInputSchema, registerInputSchema } from './auth'

describe('registerInputSchema', () => {
  it('normalizes the email address', () => {
    const parsed = registerInputSchema.parse({
      email: '  Alice@Example.COM ',
      password: 'correct horse battery',
    })
    expect(parsed.email).toBe('alice@example.com')
  })

  it('rejects short passwords', () => {
    const result = registerInputSchema.safeParse({ email: 'a@example.com', password: 'short' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email addresses', () => {
    const result = registerInputSchema.safeParse({
      email: 'not-an-email',
      password: 'correct horse battery',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginInputSchema', () => {
  it('accepts any non-empty password', () => {
    expect(loginInputSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true)
  })
})
