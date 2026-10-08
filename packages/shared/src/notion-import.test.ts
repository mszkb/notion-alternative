import { describe, expect, it } from 'vitest'
import { createZip, type ZipFile } from './zip'
import { convertNotionExport, notionTitle, readNotionArchive } from './notion-import'

// Anonymised sample in the layout of the "Markdown & CSV" export: no real content.
const ID = (n: number) => n.toString(16).padStart(32, 'a')
const enc = (text: string) => new TextEncoder().encode(text)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

const SAMPLE = [
  {
    path: `Projekte ${ID(1)}.md`,
    data: enc(
      [
        '# Projekte',
        '',
        'Übersicht mit **fett** und *kursiv*, siehe [Notizen](Projekte%20' +
          ID(1) +
          '/Notizen%20' +
          ID(2) +
          '.md).',
        '',
        '## Aufgaben',
        '',
        '- [ ] offen',
        '- [x] erledigt',
        '    - [ ] Unteraufgabe',
        '',
        '1. eins',
        '2. zwei',
        '',
        '<details>',
        '<summary>Mehr dazu</summary>',
        '',
        'Im Toggle',
        '',
        '</details>',
        '',
        '<aside>',
        '💡 Ein Hinweis',
        '</aside>',
        '',
        '---',
        '',
        '> Zitat',
        '',
        '```js',
        'const x = 1',
        '```',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        `![Foto](Projekte%20${ID(1)}/foto.png)`,
        '',
        '<span style="color:red">rot</span> und ~~alt~~ und [extern](https://example.com)',
        '',
        '#### Klein',
      ].join('\n'),
    ),
  },
  { path: `Projekte ${ID(1)}/foto.png`, data: PNG },
  {
    path: `Projekte ${ID(1)}/Notizen ${ID(2)}.md`,
    data: enc(`# Notizen\n\nZurück zu [Projekte](../Projekte%20${ID(1)}.md)\n`),
  },
  { path: `Projekte ${ID(1)}/Notizen ${ID(2)}/anhang.pdf`, data: enc('%PDF-1.4') },
  { path: `Aufgaben ${ID(3)}.csv`, data: enc('Name,Status\nEins,Fertig\n') },
  { path: `Aufgaben ${ID(3)}_all.csv`, data: enc('Name,Status\nEins,Fertig\n') },
  { path: `Aufgaben ${ID(3)}/Eins ${ID(4)}.md`, data: enc('# Eins\n\nStatus: Fertig\n') },
]

async function convert(files: ZipFile[] = SAMPLE) {
  let n = 0
  return convertNotionExport(files, {
    workspace: { id: '00000000-0000-4000-8000-000000000001', name: 'Aus Notion' },
    newId: () => `00000000-0000-4000-8000-${(++n).toString().padStart(12, '0')}`,
    now: new Date('2026-10-07T12:00:00Z'),
  })
}

describe('Notion import (#137)', () => {
  it('strips the id suffix from titles', () => {
    expect(notionTitle(`Meine Seite ${ID(9)}.md`)).toBe('Meine Seite')
    expect(notionTitle('Ohne Id.md')).toBe('Ohne Id')
  })

  it('builds the page tree, blocks, links and attachments', async () => {
    const { data, attachments, report } = await convert()
    const byTitle = new Map(data.documents.map((d) => [d.title, d]))
    const projects = byTitle.get('Projekte')!
    const notes = byTitle.get('Notizen')!
    const database = byTitle.get('Aufgaben')!
    expect(notes.parentId).toBe(projects.id)
    expect(byTitle.get('Eins')!.parentId).toBe(database.id)
    expect(projects.parentId).toBeNull()
    expect(report).toMatchObject({ pages: 4, databases: 1, attachments: 3 })

    const blocks = data.blocks
      .filter((b) => b.documentId === projects.id)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      .map((b) => [b.type, b.content, b.attrs])
    expect(blocks).toEqual([
      ['paragraph', `Übersicht mit **fett** und _kursiv_, siehe [Notizen](page:${notes.id}).`, {}],
      ['heading', 'Aufgaben', { level: 2 }],
      ['todo', 'offen', {}],
      ['todo', 'erledigt', { checked: true }],
      ['todo', 'Unteraufgabe', { indent: 1 }],
      ['list_item', 'eins', { list: 'ordered', indent: 0 }],
      ['list_item', 'zwei', { list: 'ordered', indent: 0 }],
      ['toggle', 'Mehr dazu', {}],
      ['paragraph', 'Im Toggle', { indent: 1 }],
      ['callout', 'Ein Hinweis', { icon: '💡' }],
      ['divider', '', {}],
      ['quote', 'Zitat', {}],
      ['code', 'const x = 1', { indent: 0, language: 'js' }],
      ['code', '| A | B |\n| --- | --- |\n| 1 | 2 |', {}],
      ['image', 'Foto', { attachmentId: expect.any(String) }],
      ['paragraph', 'rot und alt und [extern](https://example.com)', {}],
      ['heading', 'Klein', { level: 3 }],
    ])
    const back = data.blocks.find((b) => b.documentId === notes.id)!
    expect(back.content).toBe(`Zurück zu [Projekte](page:${projects.id})`)

    // The photo, the PDF next to the notes and the database table.
    const photo = data.attachments.find((a) => a.name === 'foto.png')!
    expect(photo).toMatchObject({
      documentId: projects.id,
      mimeType: 'image/png',
      size: PNG.length,
    })
    expect(attachments.get(photo.id)).toEqual(PNG)
    expect(data.attachments.find((a) => a.name === 'anhang.pdf')!.documentId).toBe(notes.id)
    expect(data.attachments.find((a) => a.mimeType === 'text/csv')!.documentId).toBe(database.id)

    expect(Object.keys(report.simplified)).toEqual(
      expect.arrayContaining([
        'Tabellen als Code-Block',
        'Farben und Unterstreichungen als einfacher Text',
        'Überschriften ab Ebene 4 als Ebene 3',
        'Datenbanken als Seite mit Unterseiten und CSV-Datei',
      ]),
    )
  })

  it('reads nested ZIPs of large exports and rejects foreign files', async () => {
    const modified = new Date('2026-01-01')
    const inner = createZip(SAMPLE.map((f) => ({ ...f, modified })))
    const outer = createZip([{ path: 'Export-Part-1.zip', data: inner, modified }])
    const files = await readNotionArchive(outer)
    expect(files.map((f) => f.path)).toContain(`Projekte ${ID(1)}.md`)

    await expect(readNotionArchive(enc('kein zip'))).rejects.toThrow(/keine gültige ZIP/)
    // The parts share one limit, and ZIPs inside parts are not unpacked again.
    await expect(readNotionArchive(outer, 100)).rejects.toThrow(/zu groß/)
    const deeper = createZip([{ path: 'a.zip', data: outer, modified }])
    expect((await readNotionArchive(deeper)).map((f) => f.path)).toEqual(['Export-Part-1.zip'])
    const foreign = createZip([{ path: 'bild.png', data: PNG, modified }])
    await expect(convert(await readNotionArchive(foreign))).rejects.toThrow(/keine Seiten/)
  })
})
