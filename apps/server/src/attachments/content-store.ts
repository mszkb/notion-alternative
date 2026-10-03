import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { rm } from 'node:fs/promises'
import type { Config } from '../config'
import { S3Client, type S3Config } from './s3'
import { contentPath, storeContent } from './storage'

/** Where attachment contents live: data volume (default) or S3-compatible storage (#63). */
export interface ContentStore {
  readonly kind: 'volume' | 's3'
  put(workspaceId: string, id: string, data: Buffer): Promise<void>
  /** Null if the object does not exist. */
  get(workspaceId: string, id: string): Promise<Readable | null>
  remove(workspaceId: string, id: string): Promise<void>
}

export class VolumeStore implements ContentStore {
  readonly kind = 'volume'
  constructor(readonly dir: string) {}

  put(workspaceId: string, id: string, data: Buffer) {
    return storeContent(this.dir, workspaceId, id, data)
  }

  async get(workspaceId: string, id: string) {
    const file = contentPath(this.dir, workspaceId, id)
    try {
      await access(file)
    } catch {
      return null
    }
    return createReadStream(file)
  }

  async remove(workspaceId: string, id: string) {
    await rm(contentPath(this.dir, workspaceId, id), { force: true })
  }
}

export class S3Store implements ContentStore {
  readonly kind = 's3'
  private readonly client: S3Client

  constructor(config: S3Config, fetchImpl?: typeof fetch) {
    this.client = new S3Client(config, fetchImpl)
  }

  /** Object key `<workspace>/<id>` (UUIDs only, validated like the volume path). */
  private key(workspaceId: string, id: string) {
    contentPath('/', workspaceId, id)
    return `${workspaceId}/${id}`
  }

  put(workspaceId: string, id: string, data: Buffer) {
    return this.client.put(this.key(workspaceId, id), data)
  }

  get(workspaceId: string, id: string) {
    return this.client.get(this.key(workspaceId, id))
  }

  remove(workspaceId: string, id: string) {
    return this.client.delete(this.key(workspaceId, id))
  }
}

export function createContentStore(config: Config['attachments']): ContentStore {
  return config.s3 ? new S3Store(config.s3) : new VolumeStore(config.dir)
}

/** Reads a whole stream (migration, tests). */
export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export { Readable }
