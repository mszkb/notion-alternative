import type { Attachment, Block, Document, DocumentTag, Tag } from './content'
import { parseInline, PAGE_LINK_PREFIX, serializeInline, type InlineNode } from './inline'
import { blocksToMarkdown } from './markdown'
import { compareBySortKey } from './sort-key'

/** Workspace content as stored locally or on the server, tombstones included. */
export interface ExportInput {
  documents: Document[]
  blocks: Block[]
  tags: Tag[]
  documentTags: DocumentTag[]
  attachments: Attachment[]
}

export interface MarkdownFile {
  /** Path inside the export, `/`-separated. */
  path: string
  content: string
}

export interface MarkdownExport {
  files: MarkdownFile[]
  /** Path for each exported attachment; the caller adds the content there. */
  attachmentPaths: Map<string, string>
}

export interface MarkdownExportOptions {
  /** Attachments whose content can be included; others are exported as text only. */
  availableAttachments?: Set<string>
}

/** Folder for attachment files at the export root; never used for a page. */
export const ATTACHMENT_FOLDER = '_attachments'

const MAX_NAME_LENGTH = 60
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * File name stem from a title that is valid on Windows, macOS and Linux: no reserved
 * characters or device names, no leading/trailing dots or spaces, at most 60 characters
 * (keeps nested paths below the Windows path limit).
 */
export function safeFileName(title: string, fallback = 'Unbenannt'): string {
  let name = title
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .trim()
  name = Array.from(name).slice(0, MAX_NAME_LENGTH).join('')
  name = name.replace(/^[.\s]+|[.\s]+$/g, '')
  if (!name) return fallback
  if (RESERVED_NAMES.test(name)) name = `${name}_`
  return name
}

/** Hands out unique names within one folder; comparison ignores case (Windows, macOS). */
class FolderNames {
  private used = new Set<string>()

  constructor(reserved: string[] = []) {
    for (const name of reserved) this.used.add(name.toLowerCase())
  }

  claim(stem: string, extension = ''): string {
    let candidate = stem
    for (let n = 2; this.used.has(`${candidate}${extension}`.toLowerCase()); n++) {
      candidate = `${stem} (${n})`
    }
    this.used.add(`${candidate}${extension}`.toLowerCase())
    return candidate
  }
}

function dirname(path: string): string[] {
  const parts = path.split('/')
  parts.pop()
  return parts
}

/** Percent-encodes each segment so the link works in Markdown viewers (spaces, parentheses). */
function encodePath(segments: string[]): string {
  return segments
    .map((s) =>
      s === '..' ? s : encodeURIComponent(s).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29')),
    )
    .join('/')
}

/** Relative, URL-encoded link from the file `from` to the file `to`. */
export function relativeLink(from: string, to: string): string {
  const fromDir = dirname(from)
  const target = to.split('/')
  let common = 0
  while (
    common < fromDir.length &&
    common < target.length - 1 &&
    fromDir[common] === target[common]
  ) {
    common++
  }
  const up: string[] = Array.from({ length: fromDir.length - common }, () => '..')
  return encodePath([...up, ...target.slice(common)])
}

/** Replaces page links by relative paths; links to pages not exported become plain text. */
function rewritePageLinks(content: string, resolve: (documentId: string) => string | null) {
  if (!content.includes(PAGE_LINK_PREFIX)) return content
  const map = (nodes: InlineNode[]): InlineNode[] =>
    nodes.map((node): InlineNode => {
      switch (node.type) {
        case 'page': {
          const href = resolve(node.documentId)
          const text = node.title || 'Unbenannt'
          return href
            ? { type: 'link', href, children: [{ type: 'text', text }] }
            : { type: 'text', text }
        }
        case 'bold':
        case 'italic':
        case 'link':
          return { ...node, children: map(node.children) }
        default:
          return node
      }
    })
  return serializeInline(map(parseInline(content)))
}

function frontMatter(document: Document, tags: string[]): string {
  // JSON strings are valid YAML double-quoted scalars.
  const lines = [
    '---',
    `id: ${document.id}`,
    `title: ${JSON.stringify(document.title)}`,
    `tags: ${JSON.stringify(tags)}`,
    `favorite: ${document.favorite}`,
    ...(document.icon ? [`icon: ${JSON.stringify(document.icon)}`] : []),
    `created_at: ${JSON.stringify(document.createdAt)}`,
    `updated_at: ${JSON.stringify(document.updatedAt)}`,
    '---',
  ]
  return lines.join('\n')
}

/**
 * Markdown export (ADR 0004): one file per page, folders follow the page tree (`Page.md` and
 * its subpages in `Page/`), page links as relative paths, front matter with the page metadata.
 * Only the current state: deleted pages, blocks, tags and attachments are left out.
 */
export function exportMarkdown(
  input: ExportInput,
  options: MarkdownExportOptions = {},
): MarkdownExport {
  const documents = input.documents.filter((d) => !d.deletedAt)
  const byId = new Map(documents.map((d) => [d.id, d]))
  const deletedIds = new Set(input.documents.filter((d) => d.deletedAt).map((d) => d.id))

  // Pages below a deleted page are not current; a parent unknown here makes the page a root.
  const childrenOf = new Map<string | null, Document[]>()
  for (const document of documents) {
    if (document.parentId && deletedIds.has(document.parentId)) continue
    const parent = document.parentId && byId.has(document.parentId) ? document.parentId : null
    const list = childrenOf.get(parent) ?? []
    list.push(document)
    childrenOf.set(parent, list)
  }

  const paths = new Map<string, string>()
  const assign = (parentId: string | null, folder: string[], names: FolderNames) => {
    const children = (childrenOf.get(parentId) ?? []).sort(compareBySortKey)
    for (const document of children) {
      const stem = names.claim(safeFileName(document.title))
      paths.set(document.id, [...folder, `${stem}.md`].join('/'))
      // `Page.md` and `Page/` share the stem, which is unique in this folder.
      assign(document.id, [...folder, stem], new FolderNames())
    }
  }
  assign(null, [], new FolderNames([ATTACHMENT_FOLDER]))

  const tagNames = new Map(input.tags.filter((t) => !t.deletedAt).map((t) => [t.id, t.name]))
  const tagsOf = new Map<string, string[]>()
  for (const assignment of input.documentTags) {
    const name = tagNames.get(assignment.tagId)
    if (assignment.deletedAt || !name) continue
    const list = tagsOf.get(assignment.documentId) ?? []
    if (!list.includes(name)) list.push(name)
    tagsOf.set(assignment.documentId, list)
  }

  const attachmentPaths = new Map<string, string>()
  const attachmentNames = new FolderNames()
  for (const attachment of input.attachments) {
    if (attachment.deletedAt || !paths.has(attachment.documentId)) continue
    if (options.availableAttachments && !options.availableAttachments.has(attachment.id)) continue
    const name = safeFileName(attachment.name, 'Datei')
    const dot = name.lastIndexOf('.')
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    const unique = attachmentNames.claim(stem, extension)
    attachmentPaths.set(attachment.id, `${ATTACHMENT_FOLDER}/${unique}${extension}`)
  }

  const blocksOf = new Map<string, Block[]>()
  for (const block of input.blocks) {
    if (block.deletedAt) continue
    const list = blocksOf.get(block.documentId) ?? []
    list.push(block)
    blocksOf.set(block.documentId, list)
  }

  const files: MarkdownFile[] = []
  for (const [documentId, path] of paths) {
    const document = byId.get(documentId)!
    const blocks = (blocksOf.get(documentId) ?? []).sort(compareBySortKey).map((block) => {
      const attachmentId = block.attrs.attachmentId
      if (block.type === 'image' || block.type === 'file') {
        if (attachmentId && attachmentPaths.has(attachmentId)) return block
        // Without the file a link would point nowhere; keep the caption as text.
        const label = block.content || (block.type === 'image' ? 'Bild' : 'Datei')
        return { ...block, type: 'paragraph' as const, content: `${label} (Anhang fehlt)` }
      }
      if (block.type === 'code') return block
      const content = rewritePageLinks(block.content, (target) => {
        const targetPath = paths.get(target)
        return targetPath ? relativeLink(path, targetPath) : null
      })
      return { ...block, content }
    })
    const body = blocksToMarkdown(blocks, {
      attachmentHref: (id) => relativeLink(path, attachmentPaths.get(id)!),
    })
    const head = frontMatter(document, (tagsOf.get(documentId) ?? []).sort())
    files.push({ path, content: body ? `${head}\n\n${body}\n` : `${head}\n` })
  }
  return { files, attachmentPaths }
}
