import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { jsonExportSchema } from '@notion-alt/shared'
import { expect, it } from 'vitest'
import { z } from 'zod'

const file = fileURLToPath(
  new URL('../../../docs/architecture/export.schema.json', import.meta.url),
)

// The published JSON Schema of the export (ADR 0004) must match the zod schema.
// Regenerate with `UPDATE_EXPORT_SCHEMA=1 pnpm --filter @notion-alt/web test export-schema`.
it('docs/architecture/export.schema.json matches the zod schema', () => {
  const generated = `${JSON.stringify(z.toJSONSchema(jsonExportSchema), null, 2)}\n`
  if (process.env.UPDATE_EXPORT_SCHEMA) writeFileSync(file, generated)
  expect(readFileSync(file, 'utf8')).toBe(generated)
})
