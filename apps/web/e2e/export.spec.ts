import { readFileSync } from 'node:fs'
import { jsonExportSchema, readZip, verifyExportArchive } from '@notion-alt/shared'
import type { Download, Page } from '@playwright/test'
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
  await page.getByRole('link', { name: 'Export & Import' }).click()
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

test('exports JSON with and without history', async ({ signedIn: page }) => {
  await newPage(page, 'Gelöscht bald')
  await waitForSaved(page)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Löschen' }).click()
  await newPage(page, 'Bleibt')
  await page.keyboard.type('Inhalt')
  await waitForSaved(page)
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByTestId('sync-status')).toContainText('Synchronisiert um')

  await page.getByRole('link', { name: 'Export & Import' }).click()
  const readJson = async () => {
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'JSON herunterladen' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/-json-\d{4}-\d{2}-\d{2}\.json$/)
    return jsonExportSchema.parse(JSON.parse(readFileSync((await download.path())!, 'utf8')))
  }

  const full = await readJson()
  expect(full.documents.map((d) => d.title).sort()).toEqual(['Bleibt', 'Gelöscht bald'])
  expect(full.documents.find((d) => d.title === 'Gelöscht bald')!.deletedAt).not.toBeNull()
  expect(full.blocks.some((b) => b.content === 'Inhalt')).toBe(true)
  expect(full.history!.changes.length).toBeGreaterThan(0)
  await expect(page.getByTestId('export-result')).toContainText('Änderungen im Verlauf')

  await page.getByLabel('Mit Verlauf').uncheck()
  const lean = await readJson()
  expect(lean.history).toBeNull()

  // Offline the current state is still exported.
  await takeServerDown(page)
  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByLabel('Mit Verlauf')).toBeDisabled()
  const offline = await readJson()
  expect(offline.history).toBeNull()
  expect(offline.documents).toHaveLength(2)
})

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

async function downloadVia(page: Page, button: string): Promise<Download> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: button }).click()
  return downloadPromise
}

/** Removes an attachment's content from this device, as if it was never downloaded. */
async function forgetContent(page: Page, attachmentId: string) {
  await page.evaluate(async (id) => {
    const name = (await indexedDB.databases()).find((d) => d.name?.startsWith('notion-alt-'))!.name!
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attachmentContents', 'readwrite')
      tx.objectStore('attachmentContents').delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, attachmentId)
}

test('T-EXP-01: complete ZIP with attachments, manifest and checksums', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Mit Anhängen')
  await page.keyboard.type('Bericht im Anhang.')
  await waitForSaved(page)
  await page.getByTestId('attachment-input').setInputFiles([
    { name: 'punkt.png', mimeType: 'image/png', buffer: PNG },
    { name: 'bericht.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
  ])
  await expect(page.locator('a.attachment-file')).toContainText('bericht.pdf')
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })

  await page.getByRole('link', { name: 'Export & Import' }).click()
  const download = await downloadVia(page, 'Vollständigen Export herunterladen')
  expect(download.suggestedFilename()).toMatch(/-export-\d{4}-\d{2}-\d{2}\.zip$/)
  const verified = await verifyExportArchive(new Uint8Array(readFileSync((await download.path())!)))
  expect(verified.manifest.history).toBe(true)
  expect(verified.manifest.missing_attachments).toEqual([])
  expect(verified.manifest.attachments.map((a) => a.path).sort()).toEqual([
    'markdown/_attachments/bericht.pdf',
    'markdown/_attachments/punkt.png',
  ])
  expect(verified.data.documents.map((d) => d.title)).toEqual(['Mit Anhängen'])
  expect(verified.data.history!.changes.length).toBeGreaterThan(0)
  await expect(page.getByTestId('export-result')).toContainText('1 Seite und 2 Anhänge')

  // Offline and without the PDF's content on this device: exported, but reported as missing.
  const pdf = verified.manifest.attachments.find((a) => a.path.endsWith('bericht.pdf'))!
  await forgetContent(page, pdf.id)
  await takeServerDown(page)
  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  const offline = await verifyExportArchive(
    new Uint8Array(
      readFileSync((await (await downloadVia(page, 'Vollständigen Export herunterladen')).path())!),
    ),
  )
  expect(offline.manifest.history).toBe(false)
  expect(offline.manifest.missing_attachments.map((a) => a.name)).toEqual(['bericht.pdf'])
  await expect(page.getByTestId('export-missing')).toContainText('bericht.pdf')
})

test('T-EXP-02: imports a complete export as a new workspace', async ({ signedIn: page }) => {
  await newPage(page, 'Archiv')
  await page.keyboard.type('Wichtiger Inhalt')
  await waitForSaved(page)
  await createVia(page, '+ Unterseite', 'Bilder')
  await waitForSaved(page)
  await page
    .getByTestId('attachment-input')
    .setInputFiles([{ name: 'punkt.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.locator('.attachment img')).toBeVisible()
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })

  await page.getByRole('link', { name: 'Export & Import' }).click()
  const download = await downloadVia(page, 'Vollständigen Export herunterladen')
  const archive = readFileSync((await download.path())!)

  // Garbage and tampered archives are refused before anything is sent.
  const fileInput = page.getByTestId('import-file')
  await fileInput.setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  })
  await expect(page.getByTestId('import-error')).toContainText('schema_version fehlt')
  const tampered = Buffer.from(archive)
  const at = tampered.indexOf('Wichtiger Inhalt')
  tampered.write('W', at)
  tampered.write('w', at)
  await fileInput.setInputFiles({ name: 't.zip', mimeType: 'application/zip', buffer: tampered })
  await expect(page.getByTestId('import-error')).toContainText(/CRC|Prüfsumme/)

  await fileInput.setInputFiles({
    name: 'export.zip',
    mimeType: 'application/zip',
    buffer: archive,
  })
  await expect(page.getByTestId('import-summary')).toContainText('2 Seiten, 1 Anhang')
  await page.getByLabel('Name des neuen Workspaces').fill('Wiederhergestellt')
  await page.getByRole('button', { name: 'Als neuen Workspace importieren' }).click()
  // Same server: the ids exist already, nothing is overwritten.
  await expect(page.getByTestId('import-ids-exist')).toBeVisible()
  await page.getByRole('button', { name: 'Als Kopie importieren' }).click()

  await expect(page.locator('.workspace-name')).toHaveText('Wiederhergestellt')
  const tree = page.getByRole('tree')
  await tree.getByRole('link', { name: 'Archiv' }).click()
  await expect(page.locator('.editor')).toContainText('Wichtiger Inhalt')
  await page.getByRole('link', { name: 'Bilder' }).first().click()
  await expect
    .poll(() =>
      page.locator('.attachment img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1)
  // The staged content is uploaded by the sync.
  const workspaceId = new URL(page.url()).pathname.split('/')[2]!
  const snapshot = await (
    await page.request.get(`/api/sync/snapshot?workspaceId=${workspaceId}`)
  ).json()
  const imported = snapshot.attachments[0].id as string
  await expect
    .poll(async () => (await page.request.get(`/api/attachments/${imported}/content`)).status(), {
      timeout: 10_000,
    })
    .toBe(200)
})
