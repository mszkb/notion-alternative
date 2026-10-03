import { describe, expect, it } from 'vitest'
import type { Block, Document } from './content'
import {
  createJsonExport,
  EXPORT_SCHEMA_VERSION,
  jsonExportChunks,
  jsonExportSchema,
  type ExportHistory,
} from './export-json'

const WS = '00000000-0000-4000-8000-000000000000'
const DEVICE = '00000000-0000-4000-8000-0000000000dd'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const doc = (n: number, extra: Partial<Document> = {}): Document => ({
  id: id(n),
  workspaceId: WS,
  parentId: null,
  title: `Seite ${n}`,
  sortKey: `a${n}`,
  favorite: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  revision: 1,
  deletedAt: null,
  ...extra,
})

const block = (n: number, documentId: string, content: string, extra: Partial<Block> = {}) =>
  ({
    id: id(n),
    documentId,
    type: 'paragraph',
    content,
    attrs: {},
    sortKey: `a${n}`,
    revision: 1,
    deletedAt: null,
    ...extra,
  }) satisfies Block

const history: ExportHistory = {
  compactedSeq: 0,
  changes: [
    {
      seq: 1,
      opId: id(900),
      deviceId: DEVICE,
      entity: 'document',
      entityId: id(1),
      kind: 'create',
      revision: 1,
      payload: { title: 'Seite 1', note: 'Zeile\n"zitiert"' },
      appliedAt: '2026-10-01T10:00:00.000Z',
    },
  ],
}

function sample(withHistory: boolean) {
  const a = doc(1)
  const b = doc(2, { deletedAt: '2026-10-02T00:00:00.000Z' })
  return createJsonExport(
    {
      documents: [b, a],
      blocks: [
        block(10, a.id, `Link auf [B](page:${b.id}) und [A](page:${a.id})`),
        block(11, a.id, `[x](page:${b.id})`, { type: 'code' }),
        block(12, a.id, `[weg](page:${b.id})`, { deletedAt: '2026-10-02T00:00:00.000Z' }),
      ],
      tags: [],
      documentTags: [],
      attachments: [],
    },
    {
      workspace: { id: WS, name: 'Privat' },
      exportedAt: '2026-10-03T12:00:00.000Z',
      history: withHistory ? history : null,
    },
  )
}

describe('JSON export', () => {
  it('keeps tombstones and stable ids', () => {
    const data = sample(true)
    expect(data.schema_version).toBe(EXPORT_SCHEMA_VERSION)
    expect(data.documents.map((d) => d.id)).toEqual([id(1), id(2)])
    expect(data.documents[1]!.deletedAt).not.toBeNull()
    expect(data.blocks).toHaveLength(3)
  })

  it('derives links from active, non-code blocks', () => {
    expect(sample(false).links).toEqual([
      { blockId: id(10), sourceDocumentId: id(1), targetDocumentId: id(2) },
      { blockId: id(10), sourceDocumentId: id(1), targetDocumentId: id(1) },
    ])
  })

  it.each([true, false])('serialises in chunks to valid JSON (history: %s)', (withHistory) => {
    const data = sample(withHistory)
    const chunks = [...jsonExportChunks(data)]
    expect(chunks.length).toBeGreaterThan(5)
    const parsed: unknown = JSON.parse(chunks.join(''))
    expect(parsed).toEqual(data)
    expect(jsonExportSchema.parse(parsed)).toEqual(data)
  })

  it('serialises empty workspaces', () => {
    const data = createJsonExport(
      { documents: [], blocks: [], tags: [], documentTags: [], attachments: [] },
      {
        workspace: { id: WS, name: 'Leer' },
        exportedAt: '2026-10-03T12:00:00.000Z',
        history: null,
      },
    )
    expect(jsonExportSchema.parse(JSON.parse([...jsonExportChunks(data)].join('')))).toEqual(data)
  })

  it('rejects unknown schema versions', () => {
    const data = { ...sample(false), schema_version: 99 }
    expect(jsonExportSchema.safeParse(data).success).toBe(false)
  })
})
