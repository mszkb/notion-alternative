import { onScopeDispose, ref, watch, type WatchSource } from 'vue'
import { downloadAttachment } from '../api'
import type { LocalStore } from '../local/store'
import { connection } from '../session'

/**
 * - `ready`: `url` points to the content (object URL)
 * - `missing`: not on this device and not available (offline, not uploaded yet, removed)
 * - `deleted`: the attachment was deleted
 */
export type AttachmentState = 'loading' | 'ready' | 'missing' | 'deleted'

/**
 * Object URL for an attachment's content: from this device if present, otherwise downloaded
 * (and kept for offline use). Retries when the connection comes back.
 */
export function useAttachmentUrl(
  store: LocalStore,
  attachmentId: WatchSource<string | undefined>,
  /** Changes when the metadata changed (pulled, deleted): load again. */
  reload?: WatchSource<unknown>,
) {
  const url = ref<string | null>(null)
  const state = ref<AttachmentState>('loading')
  let current: string | null = null

  const release = () => {
    if (current) URL.revokeObjectURL(current)
    current = null
    url.value = null
  }

  async function load(id: string | undefined) {
    release()
    if (!id) {
      state.value = 'missing'
      return
    }
    const attachment = await store.getAttachment(id)
    if (attachment?.deletedAt) {
      state.value = 'deleted'
      return
    }
    let content = (await store.attachmentContent(id))?.data
    if (!content && attachment && connection.value === 'online') {
      try {
        const downloaded = await downloadAttachment(id)
        if (downloaded) {
          await store.cacheAttachmentContent(id, downloaded)
          content = downloaded
        }
      } catch {
        // Stays missing; a later render retries.
      }
    }
    if (!content) {
      state.value = 'missing'
      return
    }
    current = URL.createObjectURL(
      new Blob([content], { type: attachment?.mimeType ?? 'application/octet-stream' }),
    )
    url.value = current
    state.value = 'ready'
  }

  const sources = reload ? [attachmentId, connection, reload] : [attachmentId, connection]
  watch(sources, ([id]) => void load(id as string | undefined), { immediate: true })
  onScopeDispose(release)
  return { url, state }
}
