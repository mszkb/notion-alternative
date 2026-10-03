import { describe, expect, it } from 'vitest'
import type { Attachment, Block, Document, DocumentTag, Tag } from './content'
import { exportMarkdown, relativeLink, safeFileName, type ExportInput } from './export-markdown'

const WS = '00000000-0000-4000-8000-000000000000'
let counter = 0
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function doc(title: string, parentId: string | null = null, extra: Partial<Document> = {}) {
  return {
    id: uuid(),
    workspaceId: WS,
    parentId,
    title,
    sortKey: `a${String(counter).padStart(6, '0')}`,
    favorite: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    revision: 1,
    deletedAt: null,
    ...extra,
  } satisfies Document
}

function block(documentId: string, content: string, extra: Partial<Block> = {}): Block {
  return {
    id: uuid(),
    documentId,
    type: 'paragraph',
    content,
    attrs: {},
    sortKey: `a${String(counter).padStart(6, '0')}`,
    revision: 1,
    deletedAt: null,
    ...extra,
  }
}

function input(partial: Partial<ExportInput>): ExportInput {
  return { documents: [], blocks: [], tags: [], documentTags: [], attachments: [], ...partial }
}

function file(result: ReturnType<typeof exportMarkdown>, path: string): string {
  const found = result.files.find((f) => f.path === path)
  if (!found) throw new Error(`${path} missing in ${result.files.map((f) => f.path).join(', ')}`)
  return found.content
}

describe('safeFileName', () => {
  it('replaces characters invalid on Windows and trims dots and spaces', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(safeFileName('  ..Notizen..  ')).toBe('Notizen')
    expect(safeFileName('Zeile\nzwei\tdrei')).toBe('Zeile zwei drei')
  })

  it('falls back for empty titles and avoids device names', () => {
    expect(safeFileName('')).toBe('Unbenannt')
    expect(safeFileName('...')).toBe('Unbenannt')
    expect(safeFileName('CON')).toBe('CON_')
    expect(safeFileName('com1')).toBe('com1_')
    expect(safeFileName('Console')).toBe('Console')
  })

  it('limits the length without splitting characters', () => {
    const name = safeFileName('😀'.repeat(100))
    expect(Array.from(name)).toHaveLength(60)
    expect(name).toBe('😀'.repeat(60))
  })
})

describe('relativeLink', () => {
  it('walks up and down the tree and encodes segments', () => {
    expect(relativeLink('A.md', 'B.md')).toBe('B.md')
    expect(relativeLink('A/B.md', 'C.md')).toBe('../C.md')
    expect(relativeLink('A.md', 'A/B c.md')).toBe('A/B%20c.md')
    expect(relativeLink('A/B/C.md', 'A/D (2)/E.md')).toBe('../D%20%282%29/E.md')
  })
})

describe('exportMarkdown', () => {
  it('mirrors the page tree as folders', () => {
    const root = doc('Projekte')
    const child = doc('Alpha', root.id)
    const grandchild = doc('Notizen', child.id)
    const result = exportMarkdown(input({ documents: [grandchild, child, root] }))
    expect(result.files.map((f) => f.path).sort()).toEqual([
      'Projekte.md',
      'Projekte/Alpha.md',
      'Projekte/Alpha/Notizen.md',
    ])
  })

  it('makes colliding names unique per folder, ignoring case', () => {
    const a = doc('Notiz')
    const b = doc('notiz')
    const c = doc('Notiz')
    const empty1 = doc('')
    const empty2 = doc('   ')
    const attachmentsTitle = doc('_attachments')
    const childA = doc('Notiz', a.id)
    const result = exportMarkdown(
      input({ documents: [a, b, c, empty1, empty2, attachmentsTitle, childA] }),
    )
    expect(result.files.map((f) => f.path).sort()).toEqual(
      [
        'Notiz.md',
        'Notiz/Notiz.md',
        'Unbenannt (2).md',
        'Unbenannt.md',
        '_attachments (2).md',
        'notiz (2).md',
        'Notiz (3).md',
      ].sort(),
    )
  })

  it('writes front matter with metadata and tags', () => {
    const page = doc('Er sagt: "Hallo"', null, { favorite: true })
    const tags: Tag[] = [
      { id: uuid(), workspaceId: WS, name: 'zeta', revision: 1, deletedAt: null },
      { id: uuid(), workspaceId: WS, name: 'alpha', revision: 1, deletedAt: null },
      { id: uuid(), workspaceId: WS, name: 'weg', revision: 1, deletedAt: '2026-10-02' },
    ]
    const documentTags: DocumentTag[] = tags.map((tag) => ({
      id: uuid(),
      workspaceId: WS,
      documentId: page.id,
      tagId: tag.id,
      revision: 1,
      deletedAt: null,
    }))
    const result = exportMarkdown(
      input({ documents: [page], tags, documentTags, blocks: [block(page.id, 'Text')] }),
    )
    expect(file(result, 'Er sagt- -Hallo-.md')).toBe(
      [
        '---',
        `id: ${page.id}`,
        'title: "Er sagt: \\"Hallo\\""',
        'tags: ["alpha","zeta"]',
        'favorite: true',
        'created_at: "2026-10-01T10:00:00.000Z"',
        'updated_at: "2026-10-02T10:00:00.000Z"',
        '---',
        '',
        'Text',
        '',
      ].join('\n'),
    )
  })

  it('rewrites page links as relative paths and drops links to missing pages', () => {
    const a = doc('Start')
    const b = doc('Ziel (neu)', a.id)
    const c = doc('Anderswo')
    const gone = doc('Gelöscht', null, { deletedAt: '2026-10-02T00:00:00.000Z' })
    const result = exportMarkdown(
      input({
        documents: [a, b, c, gone],
        blocks: [
          block(a.id, `Siehe [Ziel](page:${b.id}) und **[Weg](page:${gone.id})**`),
          block(b.id, `Zurück zu [Start](page:${a.id}), [Anderswo](page:${c.id})`),
          block(b.id, `[x](page:${a.id})`, { type: 'code' }),
        ],
      }),
    )
    expect(file(result, 'Start.md')).toContain(
      'Siehe [Ziel](Start/Ziel%20%28neu%29.md) und **Weg**',
    )
    const target = file(result, 'Start/Ziel (neu).md')
    expect(target).toContain('Zurück zu [Start](../Start.md), [Anderswo](../Anderswo.md)')
    // Code stays verbatim.
    expect(target).toContain(`\`\`\`\n[x](page:${a.id})\n\`\`\``)
    expect(result.files.some((f) => f.path.startsWith('Gelöscht'))).toBe(false)
  })

  it('leaves out deleted pages, their subpages and deleted blocks', () => {
    const kept = doc('Bleibt')
    const gone = doc('Weg', null, { deletedAt: '2026-10-02T00:00:00.000Z' })
    const orphan = doc('Unter Weg', gone.id)
    const result = exportMarkdown(
      input({
        documents: [kept, gone, orphan],
        blocks: [
          block(kept.id, 'sichtbar'),
          block(kept.id, 'gelöscht', { deletedAt: '2026-10-02T00:00:00.000Z' }),
        ],
      }),
    )
    expect(result.files.map((f) => f.path)).toEqual(['Bleibt.md'])
    expect(file(result, 'Bleibt.md')).toContain('sichtbar')
    expect(file(result, 'Bleibt.md')).not.toContain('gelöscht')
  })

  it('exports block types in order', () => {
    const page = doc('Typen')
    const blocks = [
      block(page.id, 'Titel', { type: 'heading', attrs: { level: 2 }, sortKey: 'a0' }),
      block(page.id, 'eins', { type: 'list_item', attrs: { list: 'ordered' }, sortKey: 'a1' }),
      block(page.id, 'zwei', { type: 'list_item', attrs: { list: 'ordered' }, sortKey: 'a2' }),
      block(page.id, 'Zitat', { type: 'quote', sortKey: 'a3' }),
      block(page.id, 'const a = 1', { type: 'code', attrs: { language: 'ts' }, sortKey: 'a4' }),
    ]
    const result = exportMarkdown(input({ documents: [page], blocks: [...blocks].reverse() }))
    expect(file(result, 'Typen.md').split('---\n\n')[1]).toBe(
      '## Titel\n\n1. eins\n2. zwei\n\n> Zitat\n\n```ts\nconst a = 1\n```\n',
    )
  })

  it('links attachments relative to the page and keeps missing ones as text', () => {
    const page = doc('Seite')
    const child = doc('Unterseite', page.id)
    const attachment = (name: string, documentId: string): Attachment => ({
      id: uuid(),
      workspaceId: WS,
      documentId,
      name,
      mimeType: 'image/png',
      size: 3,
      sha256: '0'.repeat(64),
      createdAt: '2026-10-01T10:00:00.000Z',
      revision: 1,
      deletedAt: null,
    })
    const image = attachment('foto.png', child.id)
    const sameName = attachment('Foto.png', page.id)
    const missing = attachment('fehlt.pdf', page.id)
    const result = exportMarkdown(
      input({
        documents: [page, child],
        attachments: [image, sameName, missing],
        blocks: [
          block(child.id, 'Urlaub', { type: 'image', attrs: { attachmentId: image.id } }),
          block(page.id, '', { type: 'image', attrs: { attachmentId: sameName.id } }),
          block(page.id, 'Vertrag', { type: 'file', attrs: { attachmentId: missing.id } }),
        ],
      }),
      { availableAttachments: new Set([image.id, sameName.id]) },
    )
    expect(result.attachmentPaths.get(image.id)).toBe('_attachments/foto.png')
    expect(result.attachmentPaths.get(sameName.id)).toBe('_attachments/Foto (2).png')
    expect(result.attachmentPaths.has(missing.id)).toBe(false)
    expect(file(result, 'Seite/Unterseite.md')).toContain('![Urlaub](../_attachments/foto.png)')
    const parent = file(result, 'Seite.md')
    expect(parent).toContain('![Bild](_attachments/Foto%20%282%29.png)')
    expect(parent).toContain('Vertrag (Anhang fehlt)')
  })
})
