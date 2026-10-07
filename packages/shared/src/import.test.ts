import { describe, expect, it } from 'vitest'
import type { Document } from './content'
import { createJsonExport } from './export-json'
import { ImportError, migrateExport, remapExportIds } from './import'
import { createZip, readZip } from './zip'

const WS = '00000000-0000-4000-8000-000000000000'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T = '2026-10-01T10:00:00.000Z'

const doc = (n: number, parentId: string | null = null): Document => ({
  id: id(n),
  workspaceId: WS,
  parentId,
  title: `Seite ${n}`,
  sortKey: 'a0',
  favorite: false,
  createdAt: T,
  updatedAt: T,
  revision: 1,
  deletedAt: null,
})

function sample() {
  const a = doc(1)
  const b = doc(2, a.id)
  return createJsonExport(
    {
      documents: [a, b],
      blocks: [
        {
          id: id(10),
          documentId: a.id,
          type: 'paragraph',
          content: `Zu [B](page:${b.id})`,
          attrs: {},
          sortKey: 'a0',
          revision: 1,
          deletedAt: null,
        },
      ],
      tags: [{ id: id(20), workspaceId: WS, name: 'x', revision: 1, deletedAt: null }],
      documentTags: [
        {
          id: id(21),
          workspaceId: WS,
          documentId: b.id,
          tagId: id(20),
          revision: 1,
          deletedAt: null,
        },
      ],
      attachments: [],
    },
    {
      workspace: { id: WS, name: 'Privat' },
      exportedAt: T,
      history: {
        compactedSeq: 0,
        changes: [
          {
            seq: 1,
            opId: id(90),
            deviceId: id(99),
            entity: 'block',
            entityId: id(10),
            kind: 'update',
            revision: 1,
            payload: { content: `Zu [B](page:${b.id})` },
            appliedAt: T,
          },
        ],
      },
    },
  )
}

describe('migrateExport', () => {
  it('accepts the current version', () => {
    const data = sample()
    expect(migrateExport(JSON.parse(JSON.stringify(data)))).toEqual(data)
  })

  it('runs every step from an older version, in order', () => {
    // Pretend version 3 is current: v1 called documents `pages`, v2 had no `links`.
    const steps: string[] = []
    const migrations = {
      1: ({ pages, ...rest }: Record<string, unknown>) => {
        steps.push('1->2')
        return { ...rest, documents: pages }
      },
      2: (data: Record<string, unknown>) => {
        steps.push('2->3')
        return { ...data, links: [] }
      },
    }
    const { documents, ...rest } = sample()
    const v1 = { ...rest, links: undefined, schema_version: 1, pages: documents }
    // The real schema is at version 2, so the result fails on `schema_version` only.
    expect(() => migrateExport(v1, migrations, 3)).toThrow(/\(schema_version:/)
    expect(steps).toEqual(['1->2', '2->3'])
  })

  it('rejects newer, missing and invalid versions', () => {
    expect(() => migrateExport({ ...sample(), schema_version: 3 })).toThrow(/neueren Version/)
    expect(() => migrateExport({ documents: [] })).toThrow(/schema_version fehlt/)
    expect(() => migrateExport([])).toThrow(ImportError)
    expect(() => migrateExport({ ...sample(), documents: [{ id: 'x' }] })).toThrow(/documents\.0/)
  })

  it('lifts a version 1 export unchanged to version 2 (ADR 0019)', () => {
    const data = sample()
    expect(migrateExport({ ...JSON.parse(JSON.stringify(data)), schema_version: 1 })).toEqual(data)
  })

  it('names a missing migration step', () => {
    expect(() => migrateExport({ ...sample(), schema_version: 1 }, {}, 2)).toThrow(
      /Keine Migration von schema_version 1/,
    )
  })
})

describe('remapExportIds', () => {
  it('assigns new ids and rewrites all references', () => {
    let n = 500
    const { data, idMap } = remapExportIds(sample(), () => id(n++))
    const a = idMap.get(id(1))!
    const b = idMap.get(id(2))!
    expect(data.documents.map((d) => d.id)).toEqual([a, b])
    expect(data.documents[1]!.parentId).toBe(a)
    expect(data.blocks[0]!.documentId).toBe(a)
    expect(data.blocks[0]!.content).toBe(`Zu [B](page:${b})`)
    expect(data.document_tags[0]).toMatchObject({ documentId: b, tagId: idMap.get(id(20)) })
    expect(data.links).toEqual([
      { blockId: idMap.get(id(10)), sourceDocumentId: a, targetDocumentId: b },
    ])
    const change = data.history!.changes[0]!
    expect(change.opId).toBe(idMap.get(id(90)))
    expect(change.entityId).toBe(idMap.get(id(10)))
    expect(change.payload.content).toBe(`Zu [B](page:${b})`)
    // Devices and the workspace are not entities of the export.
    expect(change.deviceId).toBe(id(99))
    expect(data.workspace.id).toBe(WS)
    expect(JSON.stringify(data)).not.toContain(id(1))
  })
})

describe('readZip with malicious archives', () => {
  const ok = createZip([{ path: 'a.txt', data: 'abc' }])

  it.each(['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/evil.txt', 'a\\..\\b', './a'])(
    'rejects the unsafe path %s',
    (path) => {
      expect(() => readZip(createZip([{ path, data: 'x' }]))).toThrow(/Unsafe path/)
    },
  )

  it('rejects duplicate entries', () => {
    expect(() =>
      readZip(
        createZip([
          { path: 'a.txt', data: '1' },
          { path: 'a.txt', data: '2' },
        ]),
      ),
    ).toThrow(/Duplicate/)
  })

  it('rejects sizes beyond the archive', () => {
    const archive = ok.slice()
    const central = archive.length - 22 - (46 + 'a.txt'.length)
    new DataView(archive.buffer).setUint32(central + 20, 0x7fffffff, true)
    new DataView(archive.buffer).setUint32(central + 24, 0x7fffffff, true)
    expect(() => readZip(archive)).toThrow(/exceeds the archive/)
  })

  it('rejects compressed entries (no decompression, no zip bombs)', () => {
    const archive = ok.slice()
    const central = archive.length - 22 - (46 + 'a.txt'.length)
    new DataView(archive.buffer).setUint16(central + 10, 8, true)
    expect(() => readZip(archive)).toThrow(/Unsupported compression/)
  })

  it('rejects truncated archives and garbage', () => {
    expect(() => readZip(ok.slice(0, ok.length - 10))).toThrow()
    expect(() => readZip(new Uint8Array(100))).toThrow(/Not a ZIP/)
  })
})
