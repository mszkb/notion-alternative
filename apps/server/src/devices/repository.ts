import type { Device } from '@notion-alt/shared'
import type { Db } from '../db/database'
import type { DevicesTable } from '../db/schema'

export function toDevice(row: DevicesTable, currentDeviceId: string | null): Device {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    current: row.id === currentDeviceId,
  }
}

/** Any device with this id, of any user, including removed ones (ids are global). */
export async function findDeviceById(db: Db, id: string) {
  return db.selectFrom('devices').selectAll().where('id', '=', id).executeTakeFirst()
}

/** Active device of the user; sync must reject operations of devices this returns nothing for. */
export async function findActiveDevice(db: Db, userId: string, id: string) {
  return db
    .selectFrom('devices')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
}

export async function listDevicesForUser(db: Db, userId: string) {
  return db
    .selectFrom('devices')
    .selectAll()
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .orderBy('last_seen_at', 'desc')
    .execute()
}

export async function insertDevice(db: Db, userId: string, id: string, name: string, now: string) {
  const row: DevicesTable = {
    id,
    user_id: userId,
    name,
    created_at: now,
    last_seen_at: now,
    revoked_at: null,
  }
  await db.insertInto('devices').values(row).execute()
  return row
}

/** Marks the device as seen (registration, later every sync run). */
export async function touchDevice(db: Db, userId: string, id: string, now: string) {
  await db
    .updateTable('devices')
    .set({ last_seen_at: now })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute()
}

export async function linkSessionToDevice(db: Db, sessionId: string, deviceId: string) {
  await db
    .updateTable('sessions')
    .set({ device_id: deviceId })
    .where('id', '=', sessionId)
    .execute()
}

/** Returns false if the user has no such active device. */
export async function renameDevice(db: Db, userId: string, id: string, name: string) {
  const result = await db
    .updateTable('devices')
    .set({ name })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/** Removes the device: its sessions end, later operations from it are rejected. */
export async function revokeDevice(db: Db, userId: string, id: string, now: string) {
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable('devices')
      .set({ revoked_at: now })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst()
    if (result.numUpdatedRows === 0n) return false
    await trx.deleteFrom('sessions').where('device_id', '=', id).execute()
    return true
  })
}
