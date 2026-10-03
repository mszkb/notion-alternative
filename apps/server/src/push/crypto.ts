import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  type ECDH,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto'

// Web Push without a library (ADR 0005): message encryption (RFC 8291, aes128gcm per RFC 8188)
// and VAPID authentication (RFC 8292) with node:crypto only.

export function base64url(data: Buffer): string {
  return data.toString('base64url')
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac('sha256', salt).update(ikm).digest()
}

/** HKDF-Expand for at most one block (all lengths here are ≤ 32). */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length)
}

export interface PushKeys {
  /** User agent public key (uncompressed P-256 point, base64url). */
  p256dh: string
  /** User agent authentication secret (16 bytes, base64url). */
  auth: string
}

/** Fixed inputs for test vectors; random in production. */
export interface EncryptionInputs {
  serverKeys?: ECDH
  salt?: Buffer
}

const RECORD_SIZE = 4096

/** Encrypts a push message body (RFC 8291 §3, single record). */
export function encryptPushMessage(
  plaintext: Buffer,
  keys: PushKeys,
  inputs: EncryptionInputs = {},
): Buffer {
  const uaPublic = Buffer.from(keys.p256dh, 'base64url')
  const authSecret = Buffer.from(keys.auth, 'base64url')
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Invalid push keys')

  const server = inputs.serverKeys ?? createECDH('prime256v1')
  if (!inputs.serverKeys) server.generateKeys()
  const asPublic = server.getPublicKey()
  const sharedSecret = server.computeSecret(uaPublic)
  const salt = inputs.salt ?? randomBytes(16)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = hkdfExpand(hkdfExtract(authSecret, sharedSecret), keyInfo, 32)
  const prk = hkdfExtract(salt, ikm)
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12)

  // Last (and only) record: padding delimiter 0x02, no further padding.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  if (encrypted.length + 86 > RECORD_SIZE) throw new Error('Push message too large')

  const header = Buffer.alloc(16 + 4 + 1)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, encrypted])
}

export interface VapidKeys {
  /** Uncompressed public point, base64url (the browser's applicationServerKey). */
  publicKey: string
  /** Private key as PKCS#8 PEM. */
  privateKey: string
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from(jwk.y!, 'base64url'),
  ])
  return {
    publicKey: base64url(point),
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
}

/** `Authorization` header value for a push service (RFC 8292, ES256 JWT, 12 h). */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
): string {
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  )
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(keys.privateKey),
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${keys.publicKey}`
}
