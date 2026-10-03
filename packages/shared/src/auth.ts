import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 256

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

export const registerInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})
export type RegisterInput = z.infer<typeof registerInputSchema>

export const loginInputSchema = z.object({
  email: emailSchema,
  // Do not enforce the length policy on login: it would leak the policy for existing accounts.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})
export type LoginInput = z.infer<typeof loginInputSchema>

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
})
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  createdAt: z.string(),
})
export type User = z.infer<typeof userSchema>

export const logoutInputSchema = z.object({
  /** Also remove this device from the account (shared computers). */
  removeDevice: z.boolean().optional(),
})
export type LogoutInput = z.infer<typeof logoutInputSchema>
