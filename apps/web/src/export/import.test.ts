import 'fake-indexeddb/auto'
import { newId } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
