import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password'

describe('password hashing', () => {
  it('verifies the correct password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^scrypt\$/)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('uses a random salt', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})
