import type { Attachment } from '@notion-alt/shared'
import { downloadAttachment } from '../api'
import { type LocalStore, sha256Hex } from './store'

export interface OfflineAttachmentsProgress {
  /** Attachments handled so far (downloaded, unavailable or failed). */
  done: number
  total: number
  /** Bytes of the handled attachments, for the progress bar. */
  bytes: number
  totalBytes: number
}

export interface OfflineAttachmentsResult {
  downloaded: number
  /** Not on the server (yet): the uploading device has not sent the content. */
  unavailable: number
  /** Download failed or the content did not match its checksum; tried again next time. */
  failed: number
  /** Stopped early: cancelled, connection lost or storage full. */
  stopped: 'cancelled' | 'offline' | 'quota' | null
}

export function isQuotaError(error: unknown): boolean {
  const names = [(error as Error)?.name, (error as { inner?: Error })?.inner?.name]
  return names.includes('QuotaExceededError')
}

/**
 * Downloads the content of every attachment that is not on this device yet, one after another,
 * so all of them are available offline (ADR 0012 loads them on demand otherwise). Content is
 * kept only if size and SHA-256 match the metadata. Network loss and a full storage stop the
 * run; what was downloaded stays.
 */
export async function downloadAllAttachments(
  store: LocalStore,
  options: {
    download?: (id: string) => Promise<ArrayBuffer | null>
    onProgress?: (progress: OfflineAttachmentsProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<OfflineAttachmentsResult> {
  const download = options.download ?? ((id: string) => downloadAttachment(id))
  const missing: Attachment[] = (await store.attachmentsOnDevice())
    .filter((entry) => !entry.local)
    .map((entry) => entry.attachment)
  const progress: OfflineAttachmentsProgress = {
    done: 0,
    total: missing.length,
    bytes: 0,
    totalBytes: missing.reduce((sum, a) => sum + a.size, 0),
  }
  const result: OfflineAttachmentsResult = {
    downloaded: 0,
    unavailable: 0,
    failed: 0,
    stopped: null,
  }
  options.onProgress?.({ ...progress })
  for (const attachment of missing) {
    if (options.signal?.aborted) {
      result.stopped = 'cancelled'
      break
    }
    const outcome = await fetchOne(attachment)
    if (outcome === 'offline' || outcome === 'quota') {
      result.stopped = outcome
      break
    }
    result[outcome]++
    progress.done++
    progress.bytes += attachment.size
    options.onProgress?.({ ...progress })
  }
  return result

  async function fetchOne(
    attachment: Attachment,
  ): Promise<'downloaded' | 'unavailable' | 'failed' | 'offline' | 'quota'> {
    let data: ArrayBuffer | null
    try {
      data = await download(attachment.id)
    } catch (error) {
      // fetch rejects with a TypeError when the network is gone: stop instead of failing all.
      return error instanceof TypeError ? 'offline' : 'failed'
    }
    if (data === null) return 'unavailable'
    if (data.byteLength !== attachment.size || (await sha256Hex(data)) !== attachment.sha256) {
      return 'failed'
    }
    try {
      await store.cacheAttachmentContent(attachment.id, data)
      return 'downloaded'
    } catch (error) {
      if (isQuotaError(error)) return 'quota'
      throw error
    }
  }
}
