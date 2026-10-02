import type { z } from 'zod'
import { HttpError } from './errors'

/** Parses untrusted input with a zod schema; responds with 400 on failure. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new HttpError(400, 'invalid_input', 'Invalid input', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
  return result.data
}
