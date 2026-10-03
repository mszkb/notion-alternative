import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Operation } from '@notion-alt/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readAll, S3Store, VolumeStore } from '../src/attachments/content-store'
import { migrateAttachments } from '../src/attachments/migrate-to-s3'
import { S3Client, type S3Config } from '../src/attachments/s3'
import { createTestApp, register } from './helpers'

// Runs against a real S3-compatible server (MinIO in CI): S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY,
// S3_TEST_SECRET_KEY. Skipped otherwise.
const endpoint = process.env.S3_TEST_ENDPOINT
const config: S3Config = {
  endpoint: endpoint ?? 'http://localhost:9000',
  region: 'us-east-1',
  // Fixed bucket, random keys: repeated runs on one server do not pile up buckets.
  bucket: 'notion-alt-test',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '',
  forcePathStyle: true,
}

describe.skipIf(!endpoint)('S3 storage (integration)', () => {
  const client = new S3Client(config)
  beforeAll(() => client.createBucket())

  it('puts, gets and deletes objects', async () => {
    const key = `${randomUUID()}/${randomUUID()}`
    expect(await client.get(key)).toBeNull()
    await client.put(key, Buffer.from('hallo s3'))
    expect((await readAll((await client.get(key))!)).toString()).toBe('hallo s3')
    await client.delete(key)
    expect(await client.get(key)).toBeNull()
    await client.delete(key)
  })

  it('serves attachments through the API exactly like the volume', async () => {
    const { app } = await createTestApp({}, { contentStore: new S3Store(config) })
    try {
      const { cookie } = await register(app, 'alice@example.com')
      const workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
        .workspaces[0].id as string
      const deviceId = randomUUID()
      await app.inject({
        method: 'POST',
        url: '/api/devices',
        headers: { cookie },
        payload: { id: deviceId, name: 'S3' },
      })
      const documentId = randomUUID()
      const id = randomUUID()
      const data = Buffer.from('Inhalt im Bucket')
      const op = (entity: Operation['entity'], entityId: string, payload: object): Operation => ({
        opId: randomUUID(),
        deviceId,
        workspaceId,
        entity,
        entityId,
        kind: 'create',
        baseRevision: null,
        payload: payload as Record<string, unknown>,
        createdAt: 'x',
      })
      await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie },
        payload: {
          operations: [
            op('document', documentId, {
              parentId: null,
              title: 'S3',
              sortKey: 'a',
              favorite: false,
              createdAt: 'x',
            }),
            op('attachment', id, {
              documentId,
              name: 'notiz.txt',
              mimeType: 'text/plain',
              size: data.length,
              sha256: createHash('sha256').update(data).digest('hex'),
              createdAt: 'x',
            }),
          ],
        },
      })
      const upload = await app.inject({
        method: 'PUT',
        url: `/api/attachments/${id}/content`,
        headers: { cookie, 'content-type': 'application/octet-stream' },
        payload: data,
      })
      expect(upload.statusCode).toBe(204)
      const download = await app.inject({
        url: `/api/attachments/${id}/content`,
        headers: { cookie },
      })
      expect(download.rawPayload.toString()).toBe('Inhalt im Bucket')
      expect(download.headers['content-disposition']).toMatch(/^attachment;/)
    } finally {
      await app.close()
    }
  })

  describe('migration volume → S3', () => {
    let dir: string
    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'migrate-'))
    })
    afterAll(() => rm(dir, { recursive: true, force: true }))

    it('copies stored files and verifies them; runs again idempotently', async () => {
      const { app, db } = await createTestApp()
      try {
        const volume = new VolumeStore(dir)
        const workspaceId = randomUUID()
        const id = randomUUID()
        const data = Buffer.from('von der Platte in den Bucket')
        await db
          .insertInto('users')
          .values({ id: 'u', email: 'm@example.com', password_hash: 'x', created_at: 'x' })
          .execute()
        await db
          .insertInto('workspaces')
          .values({ id: workspaceId, name: 'W', owner_id: 'u', created_at: 'x', compacted_seq: 0 })
          .execute()
        await db
          .insertInto('attachments')
          .values({
            id,
            workspace_id: workspaceId,
            document_id: randomUUID(),
            name: 'a.txt',
            mime_type: 'text/plain',
            size: data.length,
            sha256: createHash('sha256').update(data).digest('hex'),
            created_at: 'x',
            stored_at: 'x',
            revision: 1,
            deleted_at: null,
          })
          .execute()
        await volume.put(workspaceId, id, data)

        const s3 = new S3Store(config)
        expect(await migrateAttachments(db, volume, s3)).toEqual({
          copied: 1,
          skipped: 0,
          failed: [],
        })
        expect((await readAll((await s3.get(workspaceId, id))!)).toString()).toBe(data.toString())
        expect(await migrateAttachments(db, volume, s3)).toEqual({
          copied: 1,
          skipped: 0,
          failed: [],
        })
      } finally {
        await app.close()
      }
    })
  })
})
