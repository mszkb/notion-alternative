import { describe, expect, it } from 'vitest'
import type { Attachment, Block, Document, DocumentTag, Tag } from './content'
import {
  buildExportArchive,
  ExportArchiveError,
  sha256,
  verifyExportArchive,
} from './export-archive'
import type { ExportInput } from './export-markdown'
import { createZip, readZip } from './zip'

const WS = '00000000-0000-4000-8000-000000000000'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T = '2026-10-01T10:00:00.000Z'
const sync = { revision: 1, deletedAt: null }

const doc = (n: number, title: string, parentId: string | null = null): Document => ({
  id: id(n),
  workspaceId: WS,
  parentId,
  title,
  sortKey: `a${n}`,
  favorite: false,
  createdAt: T,
  updatedAt: T,
  ...sync,
})

async function sample(): Promise<{ input: ExportInput; contents: Map<string, Uint8Array> }> {
  const root = doc(1, 'Start')
  const child = doc(2, 'Kind', root.id)
  const photo = new Uint8Array([137, 80, 78, 71])
  const attachment = async (n: number, name: string, data: Uint8Array): Promise<Attachment> => ({
    id: id(n),
    workspaceId: WS,
    documentId: child.id,
    name,
    mimeType: 'image/png',
    size: data.length,
    sha256: await sha256(data),
    createdAt: T,
    ...sync,
  })
  const present = await attachment(20, 'foto.png', photo)
  const absent = await attachment(21, 'fehlt.png', new Uint8Array([1]))
  const tag: Tag = { id: id(30), workspaceId: WS, name: 'wichtig', ...sync }
  const assignment: DocumentTag = {
    id: id(31),
    workspaceId: WS,
    documentId: child.id,
    tagId: tag.id,
    ...sync,
  }
  const blocks: Block[] = [
    {
      id: id(10),
      documentId: root.id,
      type: 'paragraph',
      content: `Zu [Kind](page:${child.id})`,
      attrs: {},
      sortKey: 'a0',
      ...sync,
    },
    {
      id: id(11),
      documentId: child.id,
      type: 'image',
      content: 'Foto',
      attrs: { attachmentId: present.id },
      sortKey: 'a0',
      ...sync,
    },
  ]
  return {
    input: {
      documents: [root, child],
      blocks,
      tags: [tag],
      documentTags: [assignment],
      attachments: [present, absent],
    },
    contents: new Map([[present.id, photo]]),
  }
}

function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

const meta = {
  workspace: { id: WS, name: 'Privat' },
  exportedAt: new Date(T),
  history: null,
}

describe('export archive', () => {
  it('bundles Markdown, JSON, attachments and a manifest with checksums', async () => {
    const { input, contents } = await sample()
    const { parts, manifest } = await buildExportArchive(input, meta, contents)
    const archive = join(parts)
    const paths = readZip(archive).map((f) => f.path)
    expect(paths.sort()).toEqual(
      [
        'manifest.json',
        'markdown/Start.md',
        'markdown/Start/Kind.md',
        'markdown/_attachments/foto.png',
        'workspace.json',
      ].sort(),
    )
    expect(manifest.files.map((f) => f.path)).not.toContain('manifest.json')
    expect(manifest.attachments).toEqual([{ id: id(20), path: 'markdown/_attachments/foto.png' }])
    expect(manifest.missing_attachments).toEqual([
      { id: id(21), name: 'fehlt.png', documentId: id(2) },
    ])

    const verified = await verifyExportArchive(archive)
    expect(verified.data.documents).toHaveLength(2)
    expect(verified.data.links).toEqual([
      { blockId: id(10), sourceDocumentId: id(1), targetDocumentId: id(2) },
    ])
    expect(verified.data.document_tags).toHaveLength(1)
    expect(Array.from(verified.attachments.get(id(20))!)).toEqual([137, 80, 78, 71])
  })

  it('rejects archives with a modified file', async () => {
    const { input, contents } = await sample()
    const files = readZip(join((await buildExportArchive(input, meta, contents)).parts))
    const tampered = files.map((f) =>
      f.path === 'markdown/Start.md' ? { ...f, data: new TextEncoder().encode('anders') } : f,
    )
    await expect(verifyExportArchive(createZip(tampered))).rejects.toThrow(
      /Prüfsumme stimmt nicht: markdown\/Start.md/,
    )
  })

  it('rejects archives with a missing file or without manifest', async () => {
    const { input, contents } = await sample()
    const files = readZip(join((await buildExportArchive(input, meta, contents)).parts))
    await expect(
      verifyExportArchive(createZip(files.filter((f) => f.path !== 'workspace.json'))),
    ).rejects.toThrow(/Datei fehlt: workspace.json/)
    await expect(
      verifyExportArchive(createZip(files.filter((f) => f.path !== 'manifest.json'))),
    ).rejects.toThrow(ExportArchiveError)
    await expect(verifyExportArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP/)
  })

  it('rejects attachment contents that do not match their metadata', async () => {
    const { input, contents } = await sample()
    contents.set(id(20), new Uint8Array([9, 9]))
    const archive = join((await buildExportArchive(input, meta, contents)).parts)
    await expect(verifyExportArchive(archive)).rejects.toThrow(/Metadaten/)
  })
})
