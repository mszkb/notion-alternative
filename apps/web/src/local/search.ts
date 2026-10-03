import { type Block, type Document, inlineToPlainText, type Tag } from '@notion-alt/shared'
import MiniSearch from 'minisearch'
import type { LocalStore } from './store'

export interface SearchEntry {
  id: string
  title: string
  text: string
  tags: string
}

export interface SearchHit {
  id: string
  title: string
  snippet: string
  score: number
}

/** Plain text of a page's blocks: Markdown syntax removed, code kept verbatim. */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => (block.type === 'code' ? block.content : inlineToPlainText(block.content)))
    .filter(Boolean)
    .join('\n')
}

/** In-memory full-text index of one workspace (ADR 0009). */
export class SearchIndex {
  private readonly index = new MiniSearch<SearchEntry>({
    fields: ['title', 'text', 'tags'],
    storeFields: ['title', 'text'],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      combineWith: 'AND',
    },
  })

  get size(): number {
    return this.index.documentCount
  }

  upsert(entry: SearchEntry): void {
    if (this.index.has(entry.id)) this.index.replace(entry)
    else this.index.add(entry)
  }

  remove(id: string): void {
    if (this.index.has(id)) this.index.discard(id)
  }

  clear(): void {
    this.index.removeAll()
  }

  search(query: string, limit = 20): SearchHit[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    return this.index
      .search(trimmed)
      .slice(0, limit)
      .map((result) => ({
        id: result.id as string,
        title: result.title as string,
        snippet: makeSnippet(result.text as string, result.terms),
        score: result.score,
      }))
  }
}

/** A short excerpt around the first matching term. */
export function makeSnippet(text: string, terms: string[], radius = 60): string {
  if (!text) return ''
  const lower = text.toLocaleLowerCase()
  let position = -1
  for (const term of terms) {
    const index = lower.indexOf(term.toLocaleLowerCase())
    if (index !== -1 && (position === -1 || index < position)) position = index
  }
  if (position === -1) position = 0
  const start = Math.max(0, position - radius)
  const end = Math.min(text.length, position + radius)
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`
}

function entryFor(document: Document, blocks: Block[], tags: Tag[]): SearchEntry {
  return {
    id: document.id,
    title: document.title,
    text: blocksToText(blocks),
    tags: tags.map((tag) => tag.name).join(' '),
  }
}

/** Keeps a SearchIndex in step with the local store for one workspace. */
export class WorkspaceSearch {
  readonly index = new SearchIndex()
  private unsubscribe: (() => void) | null = null
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly store: LocalStore,
    readonly workspaceId: string,
    private readonly delayMs = 150,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = this.store.onChange((change) => {
      if (change.workspaceId !== this.workspaceId) return
      for (const id of change.documentIds) this.pending.add(id)
      this.schedule()
    })
    for (const { document, blocks, tags } of await this.store.documentsWithContent(
      this.workspaceId,
    )) {
      this.index.upsert(entryFor(document, blocks, tags))
    }
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.timer) clearTimeout(this.timer)
  }

  /** Applies queued updates immediately (used by tests and before searching). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ids = [...this.pending]
    this.pending.clear()
    for (const id of ids) await this.reindex(id)
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delayMs)
  }

  private async reindex(documentId: string): Promise<void> {
    const document = await this.store.getDocument(documentId)
    if (!document || document.workspaceId !== this.workspaceId) {
      this.index.remove(documentId)
      return
    }
    const [blocks, tags] = await Promise.all([
      this.store.listBlocks(documentId),
      this.store.tagsForDocument(documentId),
    ])
    this.index.upsert(entryFor(document, blocks, tags))
  }
}
