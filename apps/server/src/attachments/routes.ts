import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { type AttachmentUsage, INLINE_IMAGE_TYPES } from '@notion-alt/shared'
import { z } from 'zod'
import { currentUser, requireAuth } from '../auth/plugin'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { attachmentUsage } from '../sync/apply'
import { findWorkspaceForUser } from '../workspaces/repository'
import { readContent, storeContent } from './storage'

const paramsSchema = z.object({ id: z.uuid() })
const usageQuerySchema = z.object({ workspaceId: z.uuid() })

/** RFC 6266 filename for Content-Disposition, safe for any name. */
function disposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app
  const { dir, maxBytes } = config.attachments
  app.addHook('preHandler', requireAuth)
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: maxBytes },
    (_request, body, done) => done(null, body),
  )

  async function findOwn(id: string, userId: string) {
    const row = await db
      .selectFrom('attachments')
      .innerJoin('workspaces', 'workspaces.id', 'attachments.workspace_id')
      .selectAll('attachments')
      .where('attachments.id', '=', id)
      .where('workspaces.owner_id', '=', userId)
      .executeTakeFirst()
    // 404 for foreign attachments too: never reveal they exist.
    if (!row) throw new HttpError(404, 'not_found', 'Attachment not found')
    return row
  }

  /** Used storage and limits, so clients can check before adding files (#64). */
  app.get('/attachments/usage', async (request): Promise<AttachmentUsage> => {
    const { workspaceId } = parseInput(usageQuerySchema, request.query)
    if (!(await findWorkspaceForUser(db, workspaceId, currentUser(request).id))) {
      throw new HttpError(404, 'not_found', 'Workspace not found')
    }
    return {
      ...(await attachmentUsage(db, workspaceId)),
      quotaBytes: config.attachments.workspaceQuotaBytes,
      maxFileBytes: maxBytes,
    }
  })

  /** Uploads the content once the metadata was synced; size and SHA-256 must match. */
  app.put('/attachments/:id/content', { bodyLimit: maxBytes }, async (request, reply) => {
    const { id } = parseInput(paramsSchema, request.params)
    const row = await findOwn(id, currentUser(request).id)
    if (row.deleted_at) throw new HttpError(410, 'deleted', 'Attachment was deleted')
    if (row.stored_at) return reply.code(204).send()
    const body = request.body
    if (!Buffer.isBuffer(body)) {
      throw new HttpError(415, 'unsupported_media_type', 'Send application/octet-stream')
    }
    if (body.length !== row.size) throw new HttpError(400, 'size_mismatch', 'Size differs')
    if (createHash('sha256').update(body).digest('hex') !== row.sha256) {
      throw new HttpError(400, 'checksum_mismatch', 'Checksum differs')
    }
    await storeContent(dir, row.workspace_id, row.id, body)
    await db
      .updateTable('attachments')
      .set({ stored_at: new Date().toISOString() })
      .where('id', '=', row.id)
      .execute()
    return reply.code(204).send()
  })

  /**
   * Serves the content. Only raster images inline; everything else (SVG, HTML, PDF, …) as a
   * download, never rendered in the app's origin (stored XSS).
   */
  app.get('/attachments/:id/content', async (request, reply) => {
    const { id } = parseInput(paramsSchema, request.params)
    const row = await findOwn(id, currentUser(request).id)
    if (!row.stored_at) {
      throw new HttpError(404, 'not_uploaded', 'Content not uploaded yet or removed')
    }
    const inline = INLINE_IMAGE_TYPES.includes(row.mime_type)
    return (
      reply
        .header('Content-Type', inline ? row.mime_type : 'application/octet-stream')
        .header('Content-Length', String(row.size))
        .header('Content-Disposition', disposition(inline ? 'inline' : 'attachment', row.name))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "sandbox; default-src 'none'")
        // The content of an id never changes.
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(readContent(dir, row.workspace_id, row.id))
    )
  })
}
