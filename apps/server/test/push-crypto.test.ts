import { createECDH, createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encryptPushMessage, generateVapidKeys, vapidAuthorization } from '../src/push/crypto'
import { decryptPushMessage as decrypt } from './push-helpers'

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

describe('push message encryption (RFC 8291)', () => {
  it('reproduces the RFC test vector', () => {
    const server = createECDH('prime256v1')
    server.setPrivateKey(Buffer.from(RFC.asPrivate, 'base64url'))
    const body = encryptPushMessage(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { serverKeys: server, salt: Buffer.from(RFC.salt, 'base64url') },
    )
    expect(body.toString('base64url')).toBe(RFC.body)
  })

  it('round-trips with random keys and salt', () => {
    const ua = createECDH('prime256v1')
    ua.generateKeys()
    const auth = Buffer.alloc(16, 7).toString('base64url')
    const body = encryptPushMessage(Buffer.from('{"type":"sync_available"}'), {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth,
    })
    expect(decrypt(body, ua.getPrivateKey().toString('base64url'), auth)).toBe(
      '{"type":"sync_available"}',
    )
  })

  it('rejects malformed subscription keys', () => {
    expect(() => encryptPushMessage(Buffer.from('x'), { p256dh: 'AAAA', auth: 'AAAA' })).toThrow()
  })
})

describe('VAPID', () => {
  it('signs an ES256 JWT for the push service origin', () => {
    const keys = generateVapidKeys()
    const header = vapidAuthorization(
      'https://push.example.net/send/abc',
      keys,
      'mailto:admin@example.com',
      1_700_000_000_000,
    )
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(key).toBe(keys.publicKey)
    const [h, c, s] = token!.split('.')
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({
      aud: 'https://push.example.net',
      exp: 1_700_000_000 + 43_200,
      sub: 'mailto:admin@example.com',
    })
    const point = Buffer.from(keys.publicKey, 'base64url')
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    })
    const valid = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s!, 'base64url'),
    )
    expect(valid).toBe(true)
  })
})
