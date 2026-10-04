import { type Block, type Document, inlineToPlainText, type Tag } from '@notion-alt/shared'
import MiniSearch, { type Options } from 'minisearch'
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

const INDEX_OPTIONS: Options<SearchEntry> = {
  fields: ['title', 'text', 'tags'],
  storeFields: ['title', 'text'],
  searchOptions: {
    boost: { title: 3, tags: 2 },
    prefix: true,
    fuzzy: (term: string) => (term.length > 3 ? 0.2 : false),
    combineWith: 'AND',
  },
}

/** Version of the saved index (#98); raise it whenever `INDEX_OPTIONS` or the entries change. */
export const SEARCH_INDEX_FORMAT = 1

/** In-memory full-text index of one workspace (ADR 0009). */
export class SearchIndex {
  private index = new MiniSearch<SearchEntry>(INDEX_OPTIONS)

  /** Replaces the content with a saved index (`toJSON`). */
  load(json: string): void {
    this.index = MiniSearch.loadJSON<SearchEntry>(json, INDEX_OPTIONS)
  }

  toJSON(): string {
    return JSON.stringify(this.index)
  }

  /** Takes over the content of another index (a rebuild done on the side). */
  adopt(other: SearchIndex): void {
    this.index = other.index
  }

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

/**
 * Above this many changed pages, rebuilding from one bulk read is cheaper than loading the saved
 * index and indexing them one by one (e.g. after a re-sync).
 */
const REBUILD_SHARE = 0.25
/** Save again at start once this many pages were changed since the saved index. */
const RESAVE_AFTER = 100
/** Pages added to MiniSearch between two yields to the UI while building (#102). */
const BUILD_CHUNK = 250

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Keeps a SearchIndex in step with the local store for one workspace. The index is saved in
 * IndexedDB (#98): a start loads it and indexes only the pages changed since, instead of reading
 * the whole workspace. It is saved after a full build and when many pages changed, never while
 * editing, because serializing a large index blocks the page.
 */
export class WorkspaceSearch {
  readonly index = new SearchIndex()
  /** How the last start got its index (load test, tests). */
  startedFrom: 'cache' | 'build' | null = null
  private unsubscribe: (() => void) | null = null
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> | null = null
  private flushing: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: LocalStore,
    readonly workspaceId: string,
    private readonly delayMs = 150,
  ) {}

  /**
   * Loads or builds the index. Changes arriving meanwhile are queued and applied after it:
   * flushes wait for the start, so a loaded or built index never overwrites newer entries.
   */
  start(): Promise<void> {
    this.unsubscribe = this.store.onChange((change) => {
      if (change.workspaceId !== this.workspaceId) return
      for (const id of change.documentIds) this.pending.add(id)
      this.schedule()
    })
    this.flushing = this.load()
    return this.flushing
  }

  private async load(): Promise<void> {
    // Marks first: whatever changes after this read keeps its mark when the index is saved.
    const marks = await this.store.searchDirtyMarks(this.workspaceId)
    const cache = await this.store.searchIndexCache(this.workspaceId)
    const usable =
      cache?.format === SEARCH_INDEX_FORMAT &&
      marks.size <= Math.max(RESAVE_AFTER, cache.documentCount * REBUILD_SHARE)
    if (usable && this.tryLoad(cache.json)) {
      this.startedFrom = 'cache'
      for (const id of marks.keys()) await this.reindex(id)
      if (marks.size >= RESAVE_AFTER) this.saveLater(marks)
      return
    }
    this.startedFrom = 'build'
    await this.build(this.index)
    this.saveLater(marks)
  }

  /** Builds from one bulk read, yielding to the UI between chunks (#102). */
  private async build(target: SearchIndex): Promise<void> {
    const entries = await this.store.documentsWithContent(this.workspaceId)
    for (let i = 0; i < entries.length; i++) {
      const { document, blocks, tags } = entries[i]!
      target.upsert(entryFor(document, blocks, tags))
      if ((i + 1) % BUILD_CHUNK === 0) await yieldToUi()
    }
  }

  /**
   * Many changed pages at once (e.g. a re-sync, #102): one bulk rebuild beside the current
   * index instead of thousands of single reads, then saved so the next start loads it.
   */
  private async rebuild(): Promise<void> {
    const marks = await this.store.searchDirtyMarks(this.workspaceId)
    const fresh = new SearchIndex()
    await this.build(fresh)
    this.index.adopt(fresh)
    this.saveLater(marks)
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.timer) clearTimeout(this.timer)
  }

  /** Applies queued updates immediately (used by tests and before searching), one at a time. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // A failed earlier run must not block every later one.
    this.flushing = this.flushing.catch(() => undefined).then(() => this.applyPending())
    return this.flushing
  }

  private async applyPending(): Promise<void> {
    const ids = [...this.pending]
    this.pending.clear()
    try {
      if (ids.length > Math.max(RESAVE_AFTER, this.index.size * REBUILD_SHARE)) {
        await this.rebuild()
        return
      }
      for (const id of ids) await this.reindex(id)
    } catch (error) {
      // Try these pages again with the next change or search.
      for (const id of ids) this.pending.add(id)
      throw error
    }
  }

  /** Saves the index now; `marks` must have been read before the index took in those pages. */
  async save(marks?: Map<string, string>): Promise<void> {
    const read = marks ?? (await this.store.searchDirtyMarks(this.workspaceId))
    if (!marks) for (const id of read.keys()) await this.reindex(id)
    await this.store.saveSearchIndex(
      {
        workspaceId: this.workspaceId,
        format: SEARCH_INDEX_FORMAT,
        documentCount: this.index.size,
        json: this.index.toJSON(),
      },
      read,
    )
  }

  /** Waits for a save started by `start()` (tests, load test). */
  async saved(): Promise<void> {
    await this.saving
  }

  private tryLoad(json: string): boolean {
    try {
      this.index.load(json)
      return true
    } catch (error) {
      // A damaged cache is only a cache: rebuild.
      console.warn('Rebuilding the search index', error)
      this.index.clear()
      return false
    }
  }

  /** Saves when the page is idle; failures only cost a rebuild at the next start. */
  private saveLater(marks: Map<string, string>) {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => void })
      .requestIdleCallback
    this.saving = new Promise<void>((resolve) => {
      const run = () =>
        void this.save(marks)
          .catch((error) => console.warn('Could not save the search index', error))
          .finally(resolve)
      if (idle) idle(run, { timeout: 5000 })
      else setTimeout(run, 0)
    })
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(
      () => void this.flush().catch((error) => console.warn('Search index update failed', error)),
      this.delayMs,
    )
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
