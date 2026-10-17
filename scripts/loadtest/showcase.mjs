#!/usr/bin/env node
// Showcase and stress test (#218): fills one account with a large, readable workspace (default
// 50 000 pages in four levels: areas, projects, notes, details) through the normal sync push,
// like a client. Log in with the account afterwards to show search, page tree and first sync.
// Plain Node 22, no dependencies besides fractional-indexing from packages/shared.
//
// Usage (against a running server with ALLOW_REGISTRATION=true for a new account):
//   BASE_URL=http://127.0.0.1:3000 node scripts/loadtest/showcase.mjs
//
// Environment: BASE_URL (default http://127.0.0.1:3000), EMAIL (showcase@example.com),
// PASSWORD (showcase password 123), WORKSPACE (Showcase), PAGES (50000), DEPTH (4, at least 2),
// BLOCKS (6, average blocks per page), SEED (1).
// Ids and operation ids derive from SEED: running it again resends the same operations, which the
// server acknowledges as duplicates, so an interrupted run continues where it stopped. Ids are
// unique per server; for a second showcase on the same server use another SEED.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { generateNKeysBetween } = await import(
  createRequire(join(root, 'packages/shared/package.json')).resolve('fractional-indexing')
)

const env = (name, fallback) => process.env[name] || fallback
const BASE_URL = env('BASE_URL', 'http://127.0.0.1:3000').replace(/\/+$/, '')
const EMAIL = env('EMAIL', 'showcase@example.com')
const PASSWORD = env('PASSWORD', 'showcase password 123')
const WORKSPACE = env('WORKSPACE', 'Showcase')
const PAGES = Number(env('PAGES', 50_000))
const DEPTH = Math.max(2, Number(env('DEPTH', 4)))
const BLOCKS = Number(env('BLOCKS', 6))
const SEED = env('SEED', '1')
const BATCH = 500 // SYNC_PUSH_MAX_OPERATIONS
const BATCH_BYTES = 800_000 // below the server's 1 MiB body limit

// ---------------------------------------------------------------------------------------------
// Deterministic ids and randomness.

/** A UUID v4 derived from the seed: the same run produces the same ids. */
function uuid(...parts) {
  const hex = createHash('sha256')
    .update([SEED, ...parts].join(':'))
    .digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

let state = [...String(SEED)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
function random() {
  // Math.imul: the plain product exceeds 2^53 and loses the low bits.
  state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
  return state / 0x7fffffff
}
const pick = (list) => list[Math.floor(random() * list.length)]
const between = (min, max) => min + Math.floor(random() * (max - min + 1))

// ---------------------------------------------------------------------------------------------
// Readable German content with umlauts and recurring terms, so searches find hits on all levels.

const AREAS = [
  ['💼', 'Arbeit'],
  ['🏠', 'Haushalt'],
  ['✈️', 'Reisen'],
  ['🍲', 'Rezepte'],
  ['📚', 'Lernen'],
  ['🌱', 'Garten'],
  ['🏃', 'Gesundheit'],
  ['💶', 'Finanzen'],
  ['💡', 'Ideen'],
  ['🎵', 'Musik und Bücher'],
]
const TOPICS = [
  'Übersicht',
  'Planung',
  'Prüfung',
  'Rückblick',
  'Entwurf',
  'Budget',
  'Termine',
  'Einkauf',
  'Gemüsebeet',
  'Fahrradtour',
  'Küche',
  'Steuererklärung',
  'Wochenplan',
  'Lieblingsrezepte',
  'Projektziele',
  'Besprechung',
  'Kundenfeedback',
  'Release',
  'Datensicherung',
  'Umzug',
  'Größenvergleich',
  'Bücherliste',
  'Konzertkarten',
  'Wanderung',
  'Schlafrhythmus',
  'Fitness',
  'Kostenübersicht',
  'Versicherung',
  'Geburtstag',
  'Sprachkurs',
  'Mathematik',
  'Gitarre',
]
const NOTE_KINDS = [
  'Notiz',
  'Protokoll',
  'Checkliste',
  'Idee',
  'Frage',
  'Zusammenfassung',
  'Entwurf',
]
const PLACES = [
  'Wien',
  'München',
  'Zürich',
  'Köln',
  'Graz',
  'Lübeck',
  'Málaga',
  'Göteborg',
  'Ålesund',
]
const WORDS = (
  'wir planen prüfen besprechen notieren ändern verschieben erledigen später heute morgen ' +
  'nächste woche dringend wichtig optional entwurf ergebnis zusammenfassung übersicht ' +
  'grüner tee frühstück gemüse äpfel bohnen kürbis rhabarber zitrone ' +
  'budget rechnung überweisung kosten miete strom versicherung ' +
  'zug flug hotel wanderung strand berge ausflug museum ' +
  'kapitel übung vokabeln prüfung lernplan wiederholung ' +
  'server backup synchronisierung offline export import seite block liste'
).split(' ')
const TAGS = [
  'wichtig',
  'später',
  'erledigt',
  'privat',
  'arbeit',
  'idee',
  'reise',
  'rezept',
  'lesen',
  'frage',
  'entwurf',
  'archiv',
]
/** Each appears on exactly one page: "needle in a haystack" searches for the showcase. */
const NEEDLES = [
  'Quokka',
  'Zeppelinhafen',
  'Kaktusblüte',
  'Mondfinsternis',
  'Gürteltier',
  'Bernsteinzimmer',
]

function sentence(min = 6, max = 16) {
  const words = Array.from({ length: between(min, max) }, () => pick(WORDS))
  if (random() < 0.3) words.splice(between(0, words.length), 0, pick(PLACES))
  if (random() < 0.3) words.splice(between(0, words.length), 0, pick(TOPICS))
  const text = words.join(' ')
  return text[0].toUpperCase() + text.slice(1) + '.'
}

function title(depth, n) {
  if (depth === 1) return `${pick(TOPICS)} ${pick(PLACES)} ${n}`
  if (depth === 2) return `${pick(NOTE_KINDS)}: ${pick(TOPICS)} (KW ${between(1, 52)})`
  return `${pick(NOTE_KINDS)} ${n} – ${pick(TOPICS)}`
}

// ---------------------------------------------------------------------------------------------
// The page tree, breadth-first: the areas on top, then children with a fan-out that reaches PAGES.

function planTree() {
  // AREAS * (1 + f + f² + … + f^(DEPTH-1)) ≈ PAGES; a little more so the last level fills up.
  let fanout = 1
  const total = (f) =>
    AREAS.length * Array.from({ length: DEPTH }, (_, i) => f ** i).reduce((a, b) => a + b, 0)
  while (total(fanout) < PAGES * 1.15) fanout += 0.1
  const pages = AREAS.slice(0, Math.min(AREAS.length, PAGES)).map(([icon, name], i) => ({
    id: uuid('page', i),
    parentId: null,
    depth: 0,
    title: name,
    icon,
  }))
  const addChild = (parent) => {
    const n = pages.length
    pages.push({
      id: uuid('page', n),
      parentId: parent.id,
      depth: parent.depth + 1,
      title: title(parent.depth + 1, n),
    })
  }
  for (let i = 0; i < pages.length && pages.length < PAGES; i++) {
    const parent = pages[i]
    if (parent.depth >= DEPTH - 1) continue
    const count = Math.max(1, Math.round(fanout * (0.5 + random())))
    for (let c = 0; c < count && pages.length < PAGES; c++) addChild(parent)
  }
  // The random fan-out may end below PAGES: the rest goes to the level above the leaves.
  const lastParents = pages.filter((page) => page.depth === DEPTH - 2)
  for (let i = 0; pages.length < PAGES; i++) addChild(lastParents[i % lastParents.length])
  // Sort keys like the app's (fractional-indexing), per parent.
  const children = new Map()
  for (const page of pages) {
    if (!children.has(page.parentId)) children.set(page.parentId, [])
    children.get(page.parentId).push(page)
  }
  for (const siblings of children.values()) {
    const keys = generateNKeysBetween(null, null, siblings.length)
    siblings.forEach((page, i) => (page.sortKey = keys[i]))
  }
  for (const page of pages) page.leaf = !children.has(page.id)
  return pages
}

function blocksOf(page, index, pages) {
  const blocks = []
  const add = (type, content, attrs = {}) => blocks.push({ type, content, attrs })
  add('heading', page.title.replace(/^.*?: /, ''), { level: 2 })
  const count = Math.max(1, between(Math.ceil(BLOCKS / 2), Math.floor(BLOCKS * 1.5)))
  for (let b = 0; b < count; b++) {
    const roll = random()
    if (roll < 0.4) add('paragraph', sentence())
    else if (roll < 0.55) add('list_item', sentence(3, 8), { list: 'bullet' })
    else if (roll < 0.68) add('todo', sentence(3, 8), { checked: random() < 0.4 })
    else if (roll < 0.74) add('quote', sentence())
    else if (roll < 0.8) add('callout', sentence(4, 10), { icon: pick(['💡', '⚠️', '📌', '✅']) })
    else if (roll < 0.85)
      add(
        'code',
        `// ${pick(TOPICS)}\nconst ${pick(['summe', 'liste', 'termin'])} = ${between(1, 999)}`,
        { language: 'js' },
      )
    else if (roll < 0.9) {
      add('toggle', `Details zu ${pick(TOPICS)}`)
      add('paragraph', sentence(), { indent: 1 })
    } else if (roll < 0.95 && index > 0) {
      // A link to an earlier page (backlinks, link titles).
      const target = pages[Math.floor(random() * index)]
      add('paragraph', `Siehe auch [${target.title}](page:${target.id}) für ${pick(TOPICS)}.`)
    } else add('divider', '')
  }
  return blocks
}

// ---------------------------------------------------------------------------------------------
// HTTP.

let cookie = ''
async function request(method, path, body) {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie?.startsWith('session=')) cookie = setCookie.split(';')[0]
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null }
}

async function signIn() {
  const login = await request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
  if (login.status === 200) return 'angemeldet'
  const register = await request('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD })
  if (register.status === 201) return 'neu registriert'
  throw new Error(
    `Anmeldung fehlgeschlagen (${login.status}/${register.status}): ${JSON.stringify(register.json)}`,
  )
}

async function workspace() {
  const { json } = await request('GET', '/api/workspaces')
  const existing = json.workspaces.find((w) => w.name === WORKSPACE)
  if (existing) return existing.id
  const created = await request('POST', '/api/workspaces', { name: WORKSPACE })
  if (created.status !== 201)
    throw new Error(`Workspace: ${created.status} ${JSON.stringify(created.json)}`)
  return created.json.workspace.id
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const started = performance.now()
  console.log(`Showcase: ${PAGES.toLocaleString('de-DE')} Seiten, Tiefe ${DEPTH}, ${BASE_URL}`)
  console.log(`Konto ${EMAIL}: ${await signIn()}`)
  const workspaceId = await workspace()
  const deviceId = uuid('device')
  const device = await request('POST', '/api/devices', { id: deviceId, name: 'Showcase-Generator' })
  if (![200, 201].includes(device.status))
    throw new Error(`Gerät: ${device.status} ${JSON.stringify(device.json)}`)

  const pages = planTree()
  const createdAt = (n) => new Date(Date.UTC(2026, 0, 1) + (n % 280) * 86_400_000).toISOString()
  let opCount = 0
  const op = (entity, kind, entityId, payload, baseRevision = null) => ({
    opId: uuid('op', opCount++),
    deviceId,
    workspaceId,
    entity,
    entityId,
    kind,
    baseRevision,
    payload,
    createdAt: createdAt(opCount),
  })

  const counts = { applied: 0, duplicate: 0, blocks: 0 }
  let batch = []
  let bytes = 0
  const flush = async () => {
    if (!batch.length) return
    const { status, json } = await request('POST', '/api/sync/push', { operations: batch })
    if (status !== 200) throw new Error(`Push: ${status} ${JSON.stringify(json).slice(0, 300)}`)
    for (const [i, result] of json.results.entries()) {
      if (result.status !== 'applied' && result.status !== 'duplicate') {
        throw new Error(
          `Operation abgelehnt (${batch[i].entity} ${batch[i].kind}): ${JSON.stringify(result)}`,
        )
      }
      counts[result.status]++
    }
    batch = []
    bytes = 0
  }
  const push = async (operation) => {
    const size = JSON.stringify(operation).length
    if (batch.length >= BATCH || bytes + size > BATCH_BYTES) await flush()
    batch.push(operation)
    bytes += size
  }

  // Tags first, so pages can be tagged as they are created.
  const tagIds = TAGS.map((name) => uuid('tag', name))
  for (const [i, name] of TAGS.entries()) await push(op('tag', 'create', tagIds[i], { name }))

  const needles = new Map(
    NEEDLES.map((word, i) => [Math.floor(((i + 1) * pages.length) / (NEEDLES.length + 1)), word]),
  )
  const trash = []
  const progressEvery = Math.max(100, Math.round(pages.length / 50))
  for (const [index, page] of pages.entries()) {
    await push(
      op('document', 'create', page.id, {
        parentId: page.parentId,
        title: page.title,
        sortKey: page.sortKey,
        favorite: page.depth === 0 ? index < 3 : random() < 0.0005,
        ...(page.icon ? { icon: page.icon } : {}),
        createdAt: createdAt(index),
      }),
    )
    const blocks = blocksOf(page, index, pages)
    if (needles.has(index))
      blocks.push({
        type: 'paragraph',
        content: `Gesucht und gefunden: ${needles.get(index)}.`,
        attrs: {},
      })
    const keys = generateNKeysBetween(null, null, blocks.length)
    for (const [b, block] of blocks.entries()) {
      await push(
        op('block', 'create', uuid('block', index, b), {
          documentId: page.id,
          ...block,
          sortKey: keys[b],
        }),
      )
    }
    counts.blocks += blocks.length
    if (random() < 0.3) {
      const tags = new Set([pick(tagIds), ...(random() < 0.3 ? [pick(tagIds)] : [])])
      for (const tagId of tags) {
        await push(
          op('document_tag', 'create', uuid('document_tag', index, tagId), {
            documentId: page.id,
            tagId,
          }),
        )
      }
    }
    if (page.leaf && page.depth > 0 && !needles.has(index) && random() < 0.005) trash.push(page)
    if ((index + 1) % progressEvery === 0) {
      const seconds = (performance.now() - started) / 1000
      const rate = (index + 1) / seconds
      process.stdout.write(
        `\r${(index + 1).toLocaleString('de-DE')} / ${pages.length.toLocaleString('de-DE')} Seiten · ${Math.round(rate)}/s · noch ~${Math.round((pages.length - index - 1) / rate)} s   `,
      )
    }
  }
  // A few pages in the trash (deleted after creation, revision 1).
  for (const page of trash) await push(op('document', 'delete', page.id, {}, 1))
  await flush()

  const seconds = Math.round((performance.now() - started) / 1000)
  console.log(`\n\nFertig in ${seconds} s.`)
  console.log(
    `  Seiten: ${pages.length.toLocaleString('de-DE')} (${trash.length} im Papierkorb), Blöcke: ${counts.blocks.toLocaleString('de-DE')}`,
  )
  console.log(
    `  Operationen: ${counts.applied.toLocaleString('de-DE')} neu, ${counts.duplicate.toLocaleString('de-DE')} schon vorhanden`,
  )
  const depths = Array.from({ length: DEPTH }, (_, d) => pages.filter((p) => p.depth === d).length)
  console.log(`  Seiten je Ebene: ${depths.map((n) => n.toLocaleString('de-DE')).join(' / ')}`)
  console.log(`\nAnmelden: ${BASE_URL} mit ${EMAIL} / ${PASSWORD}, Workspace „${WORKSPACE}“`)
  console.log(`Suchbegriffe, die genau einmal vorkommen: ${NEEDLES.join(', ')}`)
  console.log(
    `Häufige Begriffe: ${['Übersicht', 'Prüfung', 'Gemüsebeet', 'Wien', 'Steuererklärung'].join(', ')}`,
  )
}

main().catch((error) => {
  console.error(`\n${error.message}`)
  process.exit(1)
})
