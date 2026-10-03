import { readFileSync } from 'node:fs'
import { readZip } from '@notion-alt/shared'
import { createVia, expect, newPage, takeServerDown, test, waitForSaved } from './fixtures'

test('exports the workspace as Markdown, offline too', async ({ signedIn: page }) => {
  await newPage(page, 'Ziel')
  await page.keyboard.type('Unterseite des Ziels folgt.')
  await waitForSaved(page)
  await createVia(page, '+ Unterseite', 'Kind')
  await page.keyboard.type('Ich bin das Kind.')
  await waitForSaved(page)

  await newPage(page, 'Quelle')
  await page.keyboard.type('Siehe [[')
  await page.getByRole('dialog', { name: 'Seite verlinken' }).getByLabel('Linkziel').fill('Kin')
  await page.keyboard.press('Enter')
  await waitForSaved(page)

  // The export reads the local database only.
  await takeServerDown(page)
  await page.getByRole('link', { name: 'Export', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown herunterladen (ZIP)' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/-markdown-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByTestId('export-result')).toContainText('3 Seiten exportiert')

  const files = readZip(new Uint8Array(readFileSync((await download.path())!)))
  const text = new Map(files.map((f) => [f.path, new TextDecoder().decode(f.data)]))
  expect([...text.keys()].sort()).toEqual(['Quelle.md', 'Ziel.md', 'Ziel/Kind.md'])
  expect(text.get('Ziel/Kind.md')).toContain('title: "Kind"')
  expect(text.get('Ziel/Kind.md')).toContain('Ich bin das Kind.')
  expect(text.get('Quelle.md')).toContain('Siehe [Kind](Ziel/Kind.md)')
})
