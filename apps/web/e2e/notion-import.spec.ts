import { createZip } from '@notion-alt/shared'
import { expect, test } from './fixtures'

// #137: moving from Notion with its "Markdown & CSV" export (anonymised sample).

const id = (n: number) => n.toString(16).padStart(32, 'c')
const enc = (text: string) => new TextEncoder().encode(text)
const modified = new Date('2026-01-01')

test('a Notion export becomes a workspace with sub-pages, to-dos and working links', async ({
  signedIn: page,
}) => {
  const zip = createZip([
    {
      path: `Wiki ${id(1)}.md`,
      data: enc(
        `# Wiki\n\n- [x] Erledigt\n\n<aside>\n⚠️ Achtung\n</aside>\n\nSiehe [Rezepte](Wiki%20${id(1)}/Rezepte%20${id(2)}.md)\n\n| A | B |\n| - | - |\n`,
      ),
      modified,
    },
    {
      path: `Wiki ${id(1)}/Rezepte ${id(2)}.md`,
      data: enc('# Rezepte\n\n## Pasta\n'),
      modified,
    },
  ])
  await page.getByRole('link', { name: 'Export & Import' }).click()
  await page
    .getByTestId('import-notion-file')
    .setInputFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) })
  const report = page.getByTestId('notion-report')
  await expect(report).toContainText('2 Seiten')
  await expect(report).toContainText('Tabellen als Code-Block')
  await page.getByRole('button', { name: 'Als neuen Workspace importieren' }).click()

  await page.getByRole('tree').getByText('Wiki').click()
  await expect(page.locator('.todo-check')).toBeChecked()
  await expect(page.locator('.block-callout')).toContainText('Achtung')
  await page.locator('.editor').getByRole('link', { name: 'Rezepte' }).click()
  await expect(page.getByLabel('Titel')).toHaveValue('Rezepte')
  await expect(page.getByRole('navigation', { name: 'Pfad' })).toContainText('Wiki')
})

test('a file that is not a Notion export is refused with a clear message', async ({
  signedIn: page,
}) => {
  await page.getByRole('link', { name: 'Export & Import' }).click()
  await page
    .getByTestId('import-notion-file')
    .setInputFiles({ name: 'foto.zip', mimeType: 'application/zip', buffer: Buffer.from('nein') })
  await expect(page.getByTestId('import-error')).toContainText('keine gültige ZIP-Datei')
})
