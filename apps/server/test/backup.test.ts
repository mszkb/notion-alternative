import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Operation } from '@notion-alt/shared'
import { Migrator } from 'kysely/migration'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { createBackup, RESTORE_SEQ_GAP, restoreBackup, verifyBackup } from '../src/backup/backup'
import { type Config, loadConfig } from '../src/config'
import { createDatabase } from '../src/db/database'
import { migrations, migrateToLatest } from '../src/db/migrate'
import { vapidKeys } from '../src/push/service'
import { PASSWORD, sessionCookie } from './helpers'

// T-BAK-01 and T-MIG-01 (#75).

let root: string

function configIn(dir: string): Config {
  const base = loadConfig({ ALLOW_REGISTRATION: 'true' })
  return {
    ...base,
    databasePath: path.join(dir, 'app.sqlite'),
    attachments: { ...base.attachments, dir: path.join(dir, 'attachments') },
  }
}

async function start(config: Config) {
  const db = createDatabase(config.databasePath)
  await migrateToLatest(db)
  const app = await buildApp({ db, config })
  return { app, db }
}

async function login(app: Awaited<ReturnType<typeof start>>['app'], email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  })
  expect(response.statusCode).toBe(200)
  return sessionCookie(response)
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'backup-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

describe('T-BAK-01: backup while running, restore into an empty environment', () => {
  it('restores content, attachments, accounts and push keys; devices re-sync', async () => {
    const source = configIn(path.join(root, 'source'))
    const { app, db } = await start(source)
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: PASSWORD },
    })
    const cookie = sessionCookie(register)
    const workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
      .workspaces[0].id
    const deviceId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { id: deviceId, name: 'Laptop' },
    })
    const op = (entity: Operation['entity'], entityId: string, payload: object): Operation => ({
      opId: randomUUID(),
      deviceId,
      workspaceId,
      entity,
      entityId,
      kind: 'create',
      baseRevision: null,
      payload: payload as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    })
    const documentId = randomUUID()
    const attachmentId = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: {
        operations: [
          op('document', documentId, {
            parentId: null,
            title: 'Gesichert',
            sortKey: 'a0',
            favorite: false,
            createdAt: 'x',
          }),
          op('block', randomUUID(), {
            documentId,
            type: 'paragraph',
            content: 'Wichtig',
            attrs: {},
            sortKey: 'a0',
          }),
          op('attachment', attachmentId, {
            documentId,
            name: 'bild.png',
            mimeType: 'image/png',
            size: PNG.length,
            sha256: createHash('sha256').update(PNG).digest('hex'),
            createdAt: 'x',
          }),
        ],
      },
    })
    const upload = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${attachmentId}/content`,
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: PNG,
    })
    expect(upload.statusCode).toBe(204)
    const keys = await vapidKeys(db)
    const before = (
      await app.inject({
        url: `/api/sync/snapshot?workspaceId=${workspaceId}`,
        headers: { cookie },
      })
    ).json()

    // Backup while the server keeps running.
    const { dir, manifest } = await createBackup(source, path.join(root, 'backups'))
    expect(manifest.missingAttachments).toEqual([])
    expect(manifest.migration).toBe(Object.keys(migrations).at(-1))
    expect(readdirSync(path.join(root, 'backups'))).toEqual([path.basename(dir)])
    // Changes after the backup: devices have them, the restored server will not.
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: {
        operations: [
          op('document', randomUUID(), {
            parentId: null,
            title: 'Nach dem Backup',
            sortKey: 'a1',
            favorite: false,
            createdAt: 'x',
          }),
        ],
      },
    })
    await app.close()

    // Fresh environment.
    const target = configIn(path.join(root, 'target'))
    const report = await restoreBackup(target, dir)
    expect(report.attachments).toBe(1)
    const restored = await start(target)
    try {
      // Sessions survive, a new login works too.
      expect(
        (await restored.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode,
      ).toBe(200)
      const newCookie = await login(restored.app, 'owner@example.com')
      const after = (
        await restored.app.inject({
          url: `/api/sync/snapshot?workspaceId=${workspaceId}`,
          headers: { cookie: newCookie },
        })
      ).json()
      expect(after.documents).toEqual(before.documents)
      expect(after.blocks).toEqual(before.blocks)
      expect(after.attachments).toEqual(before.attachments)
      const download = await restored.app.inject({
        url: `/api/attachments/${attachmentId}/content`,
        headers: { cookie: newCookie },
      })
      expect(download.rawPayload.equals(PNG)).toBe(true)
      expect(await vapidKeys(restored.db)).toEqual(keys)

      // Every device re-syncs (its cursor is below the lifted floor) ...
      const pull = await restored.app.inject({
        url: `/api/sync/pull?workspaceId=${workspaceId}&cursor=${before.cursor}`,
        headers: { cookie: newCookie },
      })
      expect(pull.statusCode).toBe(410)
      // ... and new changes never reuse sequence numbers devices saw before.
      expect(after.cursor).toBeGreaterThanOrEqual(before.cursor + RESTORE_SEQ_GAP)
    } finally {
      await restored.app.close()
    }
  })

  it('refuses to overwrite existing data and corrupt backups', async () => {
    const source = configIn(path.join(root, 'source'))
    const { app } = await start(source)
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: PASSWORD },
    })
    const { dir } = await createBackup(source, path.join(root, 'backups'))
    await app.close()

    await expect(restoreBackup(source, dir)).rejects.toThrow(/--force/)
    await expect(restoreBackup(source, dir, { force: true })).resolves.toBeDefined()

    appendFileSync(path.join(dir, 'app.sqlite'), 'x')
    await expect(verifyBackup(dir)).rejects.toThrow(/Checksum mismatch/)
    await expect(restoreBackup(configIn(path.join(root, 'other')), dir)).rejects.toThrow(/Checksum/)
    await expect(verifyBackup(path.join(root, 'nothing'))).rejects.toThrow(/no valid backup/)
  })
})

describe('T-MIG-01: restoring a backup of an older version', () => {
  it('migrates it to the current schema without losing data', async () => {
    const old = configIn(path.join(root, 'old'))
    const db = createDatabase(old.databasePath)
    // A server from before attachments (#62): migrations up to 0007 only.
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
    const { error } = await migrator.migrateTo('0007_push')
    expect(error).toBeUndefined()
    const userId = randomUUID()
    const workspaceId = randomUUID()
    const documentId = randomUUID()
    await db
      .insertInto('users')
      .values({
        id: userId,
        email: 'old@example.com',
        password_hash: await hashPassword(PASSWORD),
        created_at: '2026-01-01T00:00:00.000Z',
      })
      .execute()
    await db
      .insertInto('workspaces')
      .values({
        id: workspaceId,
        name: 'Alt',
        owner_id: userId,
        created_at: '2026-01-01T00:00:00.000Z',
        compacted_seq: 0,
      })
      .execute()
    await db
      .insertInto('documents')
      .values({
        id: documentId,
        workspace_id: workspaceId,
        parent_id: null,
        title: 'Aus Version 0007',
        sort_key: 'a0',
        favorite: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        revision: 1,
        deleted_at: null,
      })
      .execute()
    await db.destroy()

    const { dir, manifest } = await createBackup(old, path.join(root, 'backups'))
    expect(manifest.migration).toBe('0007_push')

    const target = configIn(path.join(root, 'new'))
    await restoreBackup(target, dir)
    const restored = await start(target)
    try {
      const cookie = await login(restored.app, 'old@example.com')
      const snapshot = (
        await restored.app.inject({
          url: `/api/sync/snapshot?workspaceId=${workspaceId}`,
          headers: { cookie },
        })
      ).json()
      expect(snapshot.documents.map((d: { title: string }) => d.title)).toEqual([
        'Aus Version 0007',
      ])
      // Tables of later migrations exist and work.
      expect(snapshot.attachments).toEqual([])
      const usage = await restored.app.inject({
        url: `/api/attachments/usage?workspaceId=${workspaceId}`,
        headers: { cookie },
      })
      expect(usage.statusCode).toBe(200)
    } finally {
      await restored.app.close()
    }
  })
})
