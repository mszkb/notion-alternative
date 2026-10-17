import 'fake-indexeddb/auto'
import { newId } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { importIntoWorkspace, readImportFile } from './import'
import { buildJsonExport } from './json'

let source: LocalStore
let target: LocalStore
let sourceWs: string
let targetWs: string

beforeEach(async () => {
  source = await LocalStore.open(new LocalDb(`source-${newId()}`))
  target = await LocalStore.open(new LocalDb(`target-${newId()}`))
  sourceWs = (await source.ensureLocalWorkspace()).id
  targetWs = (await target.ensureLocalWorkspace()).id
})

afterEach(async () => {
  for (const store of [source, target]) {
    store.db.close()
    await store.db.delete()
  }
})

/** An export with a page tree, a page link, a tag and a page in the trash. */
async function exportFile() {
  const parent = await source.createDocument({ workspaceId: sourceWs, title: 'Reisen' })
  const child = await source.createDocument({
    workspaceId: sourceWs,
    parentId: parent.id,
    title: 'Wien',
  })
  await source.createBlock(child.id, {
    content: `Siehe [Reisen](page:${parent.id}) für die Übersicht.`,
  })
  await source.addTag(child.id, 'Urlaub')
  const trashed = await source.createDocument({ workspaceId: sourceWs, title: 'Weg damit' })
  await source.deleteDocument(trashed.id)
  const { blob } = await buildJsonExport(source, { id: sourceWs, name: 'Mein Bereich' })
  return { file: await readImportFile(blob), parent, child }
}

describe('importIntoWorkspace (import without an account, ADR 0023)', () => {
  it('puts the active pages under a new page, as copies with new ids and links', async () => {
    const { file, parent, child } = await exportFile()

    const holderId = await importIntoWorkspace(target, file, {
      workspaceId: targetWs,
      title: 'Aus der Sicherung',
    })

    const documents = await target.listDocuments(targetWs)
    const holder = documents.find((d) => d.id === holderId)!
    expect(holder.title).toBe('Aus der Sicherung')
    const reisen = documents.find((d) => d.title === 'Reisen')!
    const wien = documents.find((d) => d.title === 'Wien')!
    expect(reisen.parentId).toBe(holderId)
    expect(wien.parentId).toBe(reisen.id)
    // New ids, so the same file can come in again or later to a server with the original.
    expect([reisen.id, wien.id]).not.toContain(parent.id)
    expect(wien.id).not.toBe(child.id)
    const contents = (await target.listBlocks(wien.id)).map((b) => b.content)
    expect(contents).toContain(`Siehe [Reisen](page:${reisen.id}) für die Übersicht.`)
    expect((await target.tagsForDocument(wien.id)).map((t) => t.name)).toEqual(['Urlaub'])
    // The trash stays behind.
    expect(documents.map((d) => d.title)).not.toContain('Weg damit')
    // Queued like every local change, sent once an account exists.
    expect(await target.pendingOperationCount()).toBeGreaterThan(0)
  })

  it('imports the same file twice as two separate copies', async () => {
    const { file } = await exportFile()

    const first = await importIntoWorkspace(target, file, { workspaceId: targetWs, title: 'Eins' })
    const second = await importIntoWorkspace(target, file, { workspaceId: targetWs, title: 'Zwei' })

    const documents = await target.listDocuments(targetWs)
    const reisen = documents.filter((d) => d.title === 'Reisen')
    expect(reisen.map((d) => d.parentId).sort()).toEqual([first, second].sort())
    expect(new Set(reisen.map((d) => d.id)).size).toBe(2)
  })

  it('a failure halfway leaves no partial copy in the tree and keeps the error', async () => {
    const { file } = await exportFile()
    const takeOver = target.takeOverPage.bind(target)
    let calls = 0
    vi.spyOn(target, 'takeOverPage').mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('Speicher voll')
      return takeOver(...args)
    })

    await expect(
      importIntoWorkspace(target, file, { workspaceId: targetWs, title: 'Halb' }),
    ).rejects.toThrow('Speicher voll')

    const titles = (await target.listDocuments(targetWs)).map((d) => d.title)
    expect(titles).not.toContain('Halb')
    expect(titles).not.toContain('Reisen')
  })

  it('a parent cycle in a damaged file does not hang; the pages still come in', async () => {
    const { file } = await exportFile()
    const [a, b] = file.data.documents.filter((d) => !d.deletedAt)
    a!.parentId = b!.id
    b!.parentId = a!.id

    const holderId = await importIntoWorkspace(target, file, {
      workspaceId: targetWs,
      title: 'Zyklus',
    })

    const documents = await target.listDocuments(targetWs)
    expect(documents.map((d) => d.title)).toEqual(expect.arrayContaining(['Reisen', 'Wien']))
    // At least one page of the cycle hangs under the new page, so all are reachable.
    expect(documents.some((d) => d.parentId === holderId)).toBe(true)
  })

  it('imports a few thousand pages without per-page scans of the whole file', async () => {
    const { file } = await exportFile()
    const template = file.data.documents.find((d) => d.title === 'Wien')!
    const block = file.data.blocks.find((b) => b.documentId === template.id)!
    for (let i = 0; i < 2000; i++) {
      const id = newId()
      file.data.documents.push({ ...template, id, title: `Seite ${i}`, parentId: null })
      for (let j = 0; j < 5; j++) {
        file.data.blocks.push({ ...block, id: newId(), documentId: id })
      }
    }
    // Counts full scans of the block list (10 000 entries), the cost that grew with each page.
    const filter = Array.prototype.filter
    let scans = 0
    const spy = vi.spyOn(Array.prototype, 'filter').mockImplementation(function (
      this: unknown[],
      ...args: Parameters<typeof filter>
    ) {
      if (this.length >= 10_000) scans++
      return filter.apply(this, args)
    })

    await importIntoWorkspace(target, file, { workspaceId: targetWs, title: 'Groß' }).finally(() =>
      spy.mockRestore(),
    )

    expect(scans).toBeLessThan(10)
    expect((await target.listDocuments(targetWs)).length).toBeGreaterThan(2000)
  }, 120_000)
})
