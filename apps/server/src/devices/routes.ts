import type { FastifyInstance } from 'fastify'
import { registerDeviceInputSchema, renameDeviceInputSchema } from '@notion-alt/shared'
import { z } from 'zod'
import { currentUser, requireAuth } from '../auth/plugin'
import { SESSION_COOKIE, sessionId } from '../auth/sessions'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import {
  findDeviceById,
  insertDevice,
  linkSessionToDevice,
  listDevicesForUser,
  renameDevice,
  revokeDevice,
  toDevice,
  touchDevice,
} from './repository'

const deviceParamsSchema = z.object({ id: z.uuid() })

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app
  app.addHook('preHandler', requireAuth)

  /**
   * Idempotent registration on every app start (also after starting offline). Links the
   * session to the device; the stored name wins over the client's default name.
   */
  app.post('/devices', async (request, reply) => {
    const input = parseInput(registerDeviceInputSchema, request.body)
    const user = currentUser(request)
    const token = request.cookies[SESSION_COOKIE]!
    const now = new Date().toISOString()

    const { row, created } = await db.transaction().execute(async (trx) => {
      const existing = await findDeviceById(trx, input.id)
      if (existing && existing.user_id !== user.id) {
        // Ids are random per browser profile and user; a clash means a forged or copied id.
        throw new HttpError(409, 'device_conflict', 'Device id belongs to another account')
      }
      if (existing?.revoked_at) {
        throw new HttpError(403, 'device_revoked', 'This device was removed from the account')
      }
      if (existing) {
        await touchDevice(trx, user.id, existing.id, now)
      } else {
        await insertDevice(trx, user.id, input.id, input.name, now)
      }
      await linkSessionToDevice(trx, sessionId(token), input.id)
      return {
        row: (await findDeviceById(trx, input.id))!,
        created: !existing,
      }
    })
    if (created) request.log.info({ userId: user.id, deviceId: row.id }, 'device registered')
    return reply.code(created ? 201 : 200).send({ device: toDevice(row, row.id) })
  })

  app.get('/devices', async (request) => {
    const rows = await listDevicesForUser(db, currentUser(request).id)
    return { devices: rows.map((row) => toDevice(row, request.deviceId)) }
  })

  app.patch('/devices/:id', async (request) => {
    const { id } = parseInput(deviceParamsSchema, request.params)
    const { name } = parseInput(renameDeviceInputSchema, request.body)
    const user = currentUser(request)
    if (!(await renameDevice(db, user.id, id, name))) {
      throw new HttpError(404, 'not_found', 'Device not found')
    }
    return { device: toDevice((await findDeviceById(db, id))!, request.deviceId) }
  })

  app.delete('/devices/:id', async (request, reply) => {
    const { id } = parseInput(deviceParamsSchema, request.params)
    const user = currentUser(request)
    if (id === request.deviceId) {
      // Removing the device in use would lock it out of syncing its own queue: sign out instead.
      throw new HttpError(409, 'current_device', 'The current device cannot be removed')
    }
    if (!(await revokeDevice(db, user.id, id, new Date().toISOString()))) {
      throw new HttpError(404, 'not_found', 'Device not found')
    }
    request.log.info({ userId: user.id, deviceId: id }, 'device removed')
    return reply.code(204).send()
  })
}
