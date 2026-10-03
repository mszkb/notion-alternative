import { createDecipheriv, createECDH, createHmac } from 'node:crypto'

/** User agent side of RFC 8291, to read what the server sends. */
export function decryptPushMessage(body: Buffer, uaPrivate: string, auth: string): string {
  const salt = body.subarray(0, 16)
  const idlen = body.readUInt8(20)
  const asPublic = body.subarray(21, 21 + idlen)
  const ua = createECDH('prime256v1')
  ua.setPrivateKey(Buffer.from(uaPrivate, 'base64url'))
  const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest()
  const expand = (prk: Buffer, info: string | Buffer, length: number) =>
    hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, length)
  const shared = ua.computeSecret(asPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic])
  const ikm = expand(hmac(Buffer.from(auth, 'base64url'), shared), keyInfo, 32)
  const prk = hmac(salt, ikm)
  const decipher = createDecipheriv(
    'aes-128-gcm',
    expand(prk, 'Content-Encoding: aes128gcm\0', 16),
    expand(prk, 'Content-Encoding: nonce\0', 12),
  )
  const record = body.subarray(21 + idlen)
  decipher.setAuthTag(record.subarray(record.length - 16))
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ])
  if (plain.at(-1) !== 2) throw new Error('missing record delimiter')
  return plain.subarray(0, -1).toString()
}
