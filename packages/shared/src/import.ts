import { z } from 'zod'
import { EXPORT_SCHEMA_VERSION, jsonExportSchema, type JsonExport } from './export-json'
import { workspaceNameSchema } from './workspace'

export class ImportError extends Error {}

/**
 * Steps that lift an export from version `n` to `n + 1` (ADR 0004). Every released version
 * keeps its step forever, so all earlier exports stay importable.
 */
export type ExportMigration = (data: Record<string, unknown>) => Record<string, unknown>
export const EXPORT_MIGRATIONS: Record<number, ExportMigration> = {}

/**
 * Brings a parsed JSON export of any released version to the current one and validates it.
 * `migrations` and `current` are parameters for tests only.
 */
export function migrateExport(
  raw: unknown,
  migrations: Record<number, ExportMigration> = EXPORT_MIGRATIONS,
  current: number = EXPORT_SCHEMA_VERSION,
): JsonExport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ImportError('Die Datei ist kein Export dieser App.')
  }
  let data = raw as Record<string, unknown>
  const version = data.schema_version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ImportError('Die Datei ist kein Export dieser App (schema_version fehlt).')
  }
  if (version > current) {
    throw new ImportError(
      `Der Export stammt aus einer neueren Version (schema_version ${version}). Bitte die App aktualisieren.`,
    )
  }
  for (let v = version; v < current; v++) {
    const step = migrations[v]
    if (!step) throw new ImportError(`Keine Migration von schema_version ${v} vorhanden.`)
    data = { ...step(data), schema_version: v + 1 }
  }
  const parsed = jsonExportSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ImportError(
      `Der Export ist ungültig (${issue?.path.join('.') || 'Wurzel'}: ${issue?.message}).`,
    )
  }
  return parsed.data
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Gives every entity (and every history operation) a new id and rewrites all references,
 * including page links and attachment ids inside content and history payloads. Used to import
 * a copy next to data that already holds the original ids.
 */
export function remapExportIds(
  data: JsonExport,
  newId: () => string,
): { data: JsonExport; idMap: Map<string, string> } {
  const idMap = new Map<string, string>()
  const add = (id: string) => {
    if (!idMap.has(id.toLowerCase())) idMap.set(id.toLowerCase(), newId())
  }
  for (const list of [
    data.documents,
    data.blocks,
    data.tags,
    data.document_tags,
    data.attachments,
  ]) {
    for (const entity of list) add(entity.id)
  }
  for (const change of data.history?.changes ?? []) add(change.opId)

  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(UUID, (match) => idMap.get(match.toLowerCase()) ?? match)
    }
    if (Array.isArray(value)) return value.map(rewrite)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
    }
    return value
  }
  const { workspace, ...rest } = data
  return { data: { ...(rewrite(rest) as Omit<JsonExport, 'workspace'>), workspace }, idMap }
}

/** `POST /api/import`: creates a new workspace from an export (never touches existing ones). */
export const importInputSchema = z.object({
  name: workspaceNameSchema,
  data: jsonExportSchema,
})
export type ImportInput = z.infer<typeof importInputSchema>
