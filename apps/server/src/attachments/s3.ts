import { createHash, createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

// Minimal S3 client on node:crypto (AWS Signature Version 4): no SDK dependency (ADR 0007),
// works with AWS, MinIO, Garage, Backblaze B2 and other S3-compatible stores (issue #63).

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** `https://host/bucket/key` (MinIO, Garage) instead of `https://bucket.host/key`. */
  forcePathStyle: boolean
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding of one path segment, as SigV4 requires (also `!'()*`). */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export interface SignInput {
  method: string
  url: URL
  /** Headers to sign besides host, x-amz-date and x-amz-content-sha256. */
  headers?: Record<string, string>
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
  date?: Date
}

/** Returns the headers to send, including `Authorization` (SigV4, header-based). */
export function signV4(input: SignInput): Record<string, string> {
  const service = input.service ?? 's3'
  const amzDate = (input.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  }
  const names = Object.keys(headers).sort()
  const query = [...input.url.searchParams]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)])
    .sort(([a], [b]) => (a! < b! ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const canonical = [
    input.method,
    input.url.pathname
      .split('/')
      .map((s) => encodeSegment(decodeURIComponent(s)))
      .join('/'),
    query,
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    names.join(';'),
    input.payloadHash,
  ].join('\n')
  const scope = `${day}/${input.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service),
    'aws4_request',
  )
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex')
  // `host` is signed but set by fetch itself.
  const sent = { ...headers }
  delete (sent as Partial<typeof sent>).host
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  }
}

/** Errors never include credentials or signed headers. */
export class S3Error extends Error {
  constructor(
    readonly status: number,
    operation: string,
  ) {
    super(`S3 ${operation} failed with status ${status}`)
    this.name = 'S3Error'
  }
}

export class S3Client {
  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(key = ''): URL {
    const base = new URL(this.config.endpoint)
    const path = key.split('/').map(encodeSegment).join('/')
    if (this.config.forcePathStyle) {
      return new URL(`${base.origin}/${encodeSegment(this.config.bucket)}${key ? `/${path}` : ''}`)
    }
    return new URL(`${base.protocol}//${this.config.bucket}.${base.host}/${path}`)
  }

  private async request(method: string, key: string, body?: Buffer) {
    const url = this.url(key)
    const headers = signV4({
      method,
      url,
      payloadHash: body ? sha256Hex(body) : sha256Hex(''),
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      headers: body ? { 'content-type': 'application/octet-stream' } : {},
    })
    return this.fetchImpl(url, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    })
  }

  async createBucket(): Promise<void> {
    const response = await this.request('PUT', '')
    // 409: exists already (owned by us) – fine.
    if (!response.ok && response.status !== 409) throw new S3Error(response.status, 'create bucket')
  }

  async put(key: string, body: Buffer): Promise<void> {
    const response = await this.request('PUT', key, body)
    if (!response.ok) throw new S3Error(response.status, 'put')
  }

  /** Object as stream, or null if it does not exist. */
  async get(key: string): Promise<Readable | null> {
    const response = await this.request('GET', key)
    if (response.status === 404) return null
    if (!response.ok || !response.body) throw new S3Error(response.status, 'get')
    return Readable.fromWeb(response.body as WebReadableStream)
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key)
    if (!response.ok && response.status !== 404) throw new S3Error(response.status, 'delete')
  }
}
