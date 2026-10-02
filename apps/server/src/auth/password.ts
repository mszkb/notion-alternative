import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
const PARAMS = { N: 2 ** 15, r: 8, p: 1 }
const KEY_LENGTH = 64
const SALT_LENGTH = 16

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: 128 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const hash = await scryptAsync(password, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$')
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
