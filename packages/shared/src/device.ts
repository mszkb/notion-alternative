import { z } from 'zod'

export const DEVICE_NAME_MAX_LENGTH = 100

export const deviceNameSchema = z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH)

export const deviceSchema = z.object({
  id: z.uuid(),
  name: deviceNameSchema,
  createdAt: z.string(),
  lastSeenAt: z.string(),
  /** The device of the session making the request. */
  current: z.boolean(),
})
export type Device = z.infer<typeof deviceSchema>

/** Registration is idempotent: the client sends its stable device id on every start. */
export const registerDeviceInputSchema = z.object({
  id: z.uuid(),
  name: deviceNameSchema,
})
export type RegisterDeviceInput = z.infer<typeof registerDeviceInputSchema>

export const renameDeviceInputSchema = z.object({ name: deviceNameSchema })
export type RenameDeviceInput = z.infer<typeof renameDeviceInputSchema>
