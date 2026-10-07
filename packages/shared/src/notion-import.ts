import type { Attachment, Block, BlockAttrs, BlockType, Document } from './content'
import { BLOCK_CONTENT_MAX_LENGTH, DOCUMENT_TITLE_MAX_LENGTH, MAX_LIST_INDENT } from './content'
import { createJsonExport, type JsonExport, jsonExportSchema } from './export-json'
import { normalize, PAGE_LINK_PREFIX, parseInline, serializeInline } from './inline'
import { sortKeysBetween } from './sort-key'
import { readZipCompressed, type ZipFile } from './zip'

/**
 * Converts the ZIP of Notion's "Export → Markdown & CSV" into our JSON export (#137), so the
 * normal import creates the workspace from it. Pages come from the `.md` files, the page tree
 * from the folders, databases (`.csv`) become a page with one sub-page per row and the CSV as an
 * attachment. Everything that has no equivalent here is simplified and listed in the report.
 */

export interface NotionImportReport {
  pages: number
  blocks: number
  attachments: number
  databases: number
  /** What was simplified, with how often it occurred. */
  simplified: Record<string, number>
}

export interface NotionImport {
  data: JsonExport
  /** Attachment contents by attachment id. */
  attachments: Map<string, Uint8Array>
  report: NotionImportReport
}

export class NotionImportError extends Error {}

/**
 * Unpacks the export ZIP. Larger exports come as a ZIP that holds one or more ZIPs ("Part-1"…);
 * those are unpacked too.
 */
export async function readNotionArchive(archive: Uint8Array): Promise<ZipFile[]> {
  let files: ZipFile[]
  try {
    files = await readZipCompressed(archive)
  } catch {
    throw new NotionImportError('Die Datei ist keine gültige ZIP-Datei.')
  }
  const nested = files.filter((f) => extension(f.path) === 'zip')
  if (nested.length > 0 && nested.length === files.length) {
    const inner: ZipFile[] = []
    for (const zip of nested) inner.push(...(await readNotionArchive(zip.data)))
    return inner
  }
  return files
}

const NOTION_ID = /^(.*?)\s+([0-9a-f]{32})$/i

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const RASTER_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function extension(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Title of a file or folder name without Notion's id suffix. */
export function notionTitle(name: string): string {
  const stem = withoutExtension(name)
  const match = NOTION_ID.exec(stem)
  return (match ? match[1]! : stem).trim()
}

/** Resolves a relative, possibly URL-encoded link against the folder of the linking file. */
function resolvePath(from: string, target: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(target.split('#')[0]!.split('?')[0]!)
  } catch {
    return null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/')) return null
  const parts = from ? from.split('/') : []
  for (const segment of decoded.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment !== '.' && segment !== '') parts.push(segment)
  }
  return parts.join('/')
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

interface DraftBlock {
  type: BlockType
  content: string
  attrs: BlockAttrs
}

interface PageDraft {
  id: string
  path: string
  title: string
  parentPath: string | null
  blocks: DraftBlock[]
}

export async function convertNotionExport(
  files: ZipFile[],
  options: { workspace: { id: string; name: string }; newId: () => string; now: Date },
): Promise<NotionImport> {
  const report: NotionImportReport = {
    pages: 0,
    blocks: 0,
    attachments: 0,
    databases: 0,
    simplified: {},
  }
  const simplify = (what: string) => (report.simplified[what] = (report.simplified[what] ?? 0) + 1)
  const now = options.now.toISOString()
  const byPath = new Map(files.map((file) => [file.path, file]))
  const decoder = new TextDecoder()

  const markdown = files.filter((f) => extension(f.path) === 'md')
  const csvFiles = files.filter(
    (f) =>
      extension(f.path) === 'csv' &&
      !(f.path.endsWith('_all.csv') && byPath.has(f.path.replace(/_all\.csv$/, '.csv'))),
  )
  if (markdown.length === 0 && csvFiles.length === 0) {
    throw new NotionImportError(
      'Die ZIP-Datei enthält keine Seiten (.md). Erwartet wird ein Export im Format „Markdown & CSV“.',
    )
  }

  // ---------------------------------------------------------------- pages and their tree

  const pages = new Map<string, PageDraft>()
  // A page's folder holds its sub-pages and files: "Title id.md" ↔ "Title id/".
  const pageForFolder = new Map<string, PageDraft>()
  const addPage = (path: string, title: string, folder = withoutExtension(path)) => {
    const page: PageDraft = {
      id: options.newId(),
      path,
      title: title.slice(0, DOCUMENT_TITLE_MAX_LENGTH),
      parentPath: null,
      blocks: [],
    }
    pages.set(path, page)
    pageForFolder.set(folder, page)
    return page
  }
  for (const file of markdown) addPage(file.path, notionTitle(basename(file.path)))
  for (const file of csvFiles) {
    const folder = withoutExtension(file.path).replace(/_all$/, '')
    if (pageForFolder.has(folder)) continue
    addPage(file.path, notionTitle(`${basename(folder)}.csv`), folder)
    report.databases++
  }
  // A folder without a page of its own becomes a page, except at the top level (e.g. a folder
  // wrapping the whole export), which would only add a level.
  const folderPage = (folder: string): PageDraft | null => {
    if (!folder) return null
    const existing = pageForFolder.get(folder)
    if (existing) return existing
    const parent = dirname(folder)
    if (!parent) return null
    const page = addPage(`${folder}.folder`, notionTitle(basename(folder)), folder)
    page.parentPath = folderPage(parent)?.path ?? null
    return page
  }
  for (const page of [...pages.values()]) {
    if (page.path.endsWith('.folder')) continue
    page.parentPath = folderPage(dirname(page.path))?.path ?? null
  }

  // ---------------------------------------------------------------- attachments

  const attachments: Attachment[] = []
  const contents = new Map<string, Uint8Array>()
  const attachmentByPath = new Map<string, Attachment>()
  const attach = async (path: string, page: PageDraft): Promise<Attachment | null> => {
    const known = attachmentByPath.get(path)
    if (known) return known
    const file = byPath.get(path)
    if (!file) return null
    const attachment: Attachment = {
      id: options.newId(),
      workspaceId: options.workspace.id,
      documentId: page.id,
      name: basename(path).slice(0, 255) || 'Datei',
      mimeType: MIME_TYPES[extension(path)] ?? 'application/octet-stream',
      size: file.data.length,
      sha256: await sha256Hex(file.data),
      createdAt: now,
      revision: null,
      deletedAt: null,
    }
    attachments.push(attachment)
    attachmentByPath.set(path, attachment)
    contents.set(attachment.id, file.data)
    report.attachments++
    return attachment
  }
  const fileBlock = (attachment: Attachment, caption: string): DraftBlock => ({
    type: RASTER_IMAGES.has(attachment.mimeType) ? 'image' : 'file',
    content: caption,
    attrs: { attachmentId: attachment.id },
  })

  // ---------------------------------------------------------------- inline content

  const inline = (text: string, from: PageDraft): string => {
    const folder = dirname(from.path)
    const rewritten = text
      // HTML Notion uses for colours and underline: keep the text.
      .replace(/<\/?(?:span|u|mark|sup|sub|br)[^>]*>/gi, (tag) => {
        simplify('Farben und Unterstreichungen als einfacher Text')
        return tag.toLowerCase().startsWith('<br') ? '\n' : ''
      })
      .replace(/~~(.+?)~~/g, (_, inner: string) => {
        simplify('Durchgestrichen als einfacher Text')
        return inner
      })
      .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label: string, target: string) => {
        if (/^(https?:|mailto:)/i.test(target)) return whole
        const path = resolvePath(folder, target)
        const page = path ? (pages.get(path) ?? pageForFolder.get(withoutExtension(path))) : null
        if (page) return `[${label || page.title}](${PAGE_LINK_PREFIX}${page.id})`
        simplify('Links auf Dateien oder fehlende Seiten als Text')
        return label
      })
    const content = serializeInline(normalize(parseInline(rewritten)))
    if (content.length > BLOCK_CONTENT_MAX_LENGTH) {
      simplify('Sehr lange Absätze gekürzt')
      return content.slice(0, BLOCK_CONTENT_MAX_LENGTH)
    }
    return content
  }

  // ---------------------------------------------------------------- Markdown → blocks

  const parse = async (page: PageDraft, source: string) => {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const out: DraftBlock[] = []
    let extra = 0 // indent added by open <details> toggles
    let paragraph: string[] = []
    let paragraphIndent = 0
    const push = (block: DraftBlock) => {
      const indent = Math.min(MAX_LIST_INDENT, (block.attrs.indent ?? 0) + extra)
      out.push({ ...block, attrs: indent ? { ...block.attrs, indent } : block.attrs })
    }
    const flush = () => {
      if (paragraph.length === 0) return
      push({
        type: 'paragraph',
        content: inline(paragraph.join('\n'), page),
        attrs: paragraphIndent ? { indent: paragraphIndent } : {},
      })
      paragraph = []
    }
    let i = 0
    // The first heading repeats the title.
    while (i < lines.length && !lines[i]!.trim()) i++
    if (lines[i]?.startsWith('# ')) i++

    for (; i < lines.length; i++) {
      const raw = lines[i]!
      const line = raw.trimEnd()
      const spaces = raw.length - raw.trimStart().length
      // Notion indents nested items by four spaces; two are read as one level too.
      const indent = Math.min(MAX_LIST_INDENT, Math.ceil(spaces / 4))
      const text = line.trim()

      if (!text) {
        flush()
        continue
      }
      const fence = /^(`{3,}|~{3,})(.*)$/.exec(text)
      if (fence) {
        flush()
        const code: string[] = []
        for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) {
          code.push(
            lines[i]!.slice(Math.min(spaces, lines[i]!.length - lines[i]!.trimStart().length)),
          )
        }
        const language = fence[2]!.trim().slice(0, 40)
        push({
          type: 'code',
          content: code.join('\n'),
          attrs: { indent, ...(language ? { language } : {}) },
        })
        continue
      }
      if (/^<details/i.test(text)) {
        flush()
        const summary =
          /<summary>(.*?)<\/summary>/i.exec(text) ??
          /<summary>(.*?)<\/summary>/i.exec(lines[i + 1] ?? '')
        if (!/<summary>/i.test(text) && summary) i++
        push({
          type: 'toggle',
          content: inline(summary?.[1] ?? '', page),
          attrs: indent ? { indent } : {},
        })
        extra++
        continue
      }
      if (/^<\/details>/i.test(text)) {
        flush()
        extra = Math.max(0, extra - 1)
        continue
      }
      if (/^<aside>/i.test(text)) {
        flush()
        const body: string[] = []
        const first = text
          .replace(/^<aside>/i, '')
          .replace(/<\/aside>$/i, '')
          .trim()
        if (first) body.push(first)
        if (!/<\/aside>$/i.test(text)) {
          for (i++; i < lines.length && !/<\/aside>/i.test(lines[i]!); i++) {
            if (lines[i]!.trim()) body.push(lines[i]!.trim())
          }
          const last = (lines[i] ?? '').replace(/<\/aside>.*/i, '').trim()
          if (last) body.push(last)
        }
        let joined = body.join('\n')
        const emoji = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u.exec(
          joined,
        )
        const icon = emoji ? emoji[1]! : '💡'
        if (emoji) joined = joined.slice(emoji[0].length)
        push({
          type: 'callout',
          content: inline(joined, page),
          attrs: { icon, ...(indent ? { indent } : {}) },
        })
        continue
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
        flush()
        push({ type: 'divider', content: '', attrs: {} })
        continue
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(text)
      if (heading) {
        flush()
        if (heading[1]!.length > 3) simplify('Überschriften ab Ebene 4 als Ebene 3')
        const level = Math.min(3, heading[1]!.length)
        push({ type: 'heading', content: inline(heading[2]!, page), attrs: { level } })
        continue
      }
      const todo = /^[-*+]\s+\[( |x|X)\]\s?(.*)$/.exec(text)
      if (todo) {
        flush()
        push({
          type: 'todo',
          content: inline(todo[2]!, page),
          attrs: { ...(todo[1] !== ' ' ? { checked: true } : {}), ...(indent ? { indent } : {}) },
        })
        continue
      }
      const bullet = /^[-*+]\s+(.*)$/.exec(text)
      const ordered = /^\d+[.)]\s+(.*)$/.exec(text)
      if (bullet || ordered) {
        flush()
        push({
          type: 'list_item',
          content: inline((bullet ?? ordered)![1]!, page),
          attrs: { list: bullet ? 'bullet' : 'ordered', indent },
        })
        continue
      }
      if (text.startsWith('>')) {
        flush()
        const quote = [text.replace(/^>\s?/, '')]
        while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith('>')) {
          quote.push(lines[++i]!.trim().replace(/^>\s?/, ''))
        }
        push({
          type: 'quote',
          content: inline(quote.join('\n'), page),
          attrs: indent ? { indent } : {},
        })
        continue
      }
      if (text.startsWith('|')) {
        flush()
        const table = [text]
        while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith('|'))
          table.push(lines[++i]!.trim())
        simplify('Tabellen als Code-Block')
        push({ type: 'code', content: table.join('\n'), attrs: {} })
        continue
      }
      const media = /^!?\[([^\]]*)\]\(([^)\s]+)\)$/.exec(text)
      if (media && !/^(https?:|mailto:)/i.test(media[2]!)) {
        const path = resolvePath(dirname(page.path), media[2]!)
        if (path && byPath.has(path) && extension(path) !== 'md') {
          flush()
          const attachment = await attach(path, page)
          if (attachment) {
            push(fileBlock(attachment, inline(media[1]! === basename(path) ? '' : media[1]!, page)))
            continue
          }
        }
      }
      // Inline tags (colour, underline) are handled with the text; other HTML is dropped.
      const other = /<(?!\/?(?:span|u|mark|sup|sub|br)\b)\/?[a-z][^>]*>/gi
      if (other.test(text)) simplify('Sonstiges HTML als Text')
      if (paragraph.length === 0) paragraphIndent = indent
      paragraph.push(text.replace(other, ''))
    }
    flush()
    page.blocks.push(...out)
  }

  for (const page of pages.values()) {
    const file = byPath.get(page.path)
    if (page.path.endsWith('.md') && file) {
      await parse(page, decoder.decode(file.data))
    } else if (page.path.endsWith('.csv') && file) {
      // The database's table stays complete as a file; its rows are the sub-pages.
      const attachment = await attach(page.path, page)
      if (attachment) page.blocks.push(fileBlock(attachment, 'Tabelle (CSV)'))
      simplify('Datenbanken als Seite mit Unterseiten und CSV-Datei')
    }
  }

  // Files in a page's folder that no page references are kept as attachments of that page.
  for (const file of files) {
    const ext = extension(file.path)
    if (ext === 'md' || ext === 'csv' || attachmentByPath.has(file.path)) continue
    const page = pageForFolder.get(dirname(file.path))
    if (!page) {
      simplify('Dateien außerhalb von Seiten übersprungen')
      continue
    }
    const attachment = await attach(file.path, page)
    if (attachment) page.blocks.push(fileBlock(attachment, ''))
  }

  // ---------------------------------------------------------------- entities

  const documents: Document[] = []
  const blocks: Block[] = []
  const children = new Map<string | null, PageDraft[]>()
  for (const page of pages.values()) {
    const list = children.get(page.parentPath) ?? []
    list.push(page)
    children.set(page.parentPath, list)
  }
  for (const [parentPath, list] of children) {
    list.sort((a, b) => a.title.localeCompare(b.title, 'de'))
    const keys = sortKeysBetween(null, null, list.length)
    list.forEach((page, index) => {
      documents.push({
        id: page.id,
        workspaceId: options.workspace.id,
        parentId: parentPath ? (pages.get(parentPath)?.id ?? null) : null,
        title: page.title,
        sortKey: keys[index]!,
        favorite: false,
        createdAt: now,
        updatedAt: now,
        revision: null,
        deletedAt: null,
      })
      const blockKeys = sortKeysBetween(null, null, page.blocks.length)
      page.blocks.forEach((block, i) => {
        blocks.push({
          id: options.newId(),
          documentId: page.id,
          type: block.type,
          content: block.content,
          attrs: block.attrs,
          sortKey: blockKeys[i]!,
          revision: null,
          deletedAt: null,
        })
      })
    })
  }
  report.pages = documents.length
  report.blocks = blocks.length

  const data = createJsonExport(
    { documents, blocks, tags: [], documentTags: [], attachments },
    { workspace: options.workspace, exportedAt: now, history: null },
  )
  const checked = jsonExportSchema.safeParse(data)
  if (!checked.success) {
    const issue = checked.error.issues[0]
    throw new NotionImportError(
      `Der Export konnte nicht übernommen werden (${issue?.path.join('.')}: ${issue?.message}).`,
    )
  }
  return { data: checked.data, attachments: contents, report }
}
