#!/usr/bin/env node
// Load test for the backend (#77): seeds a large workspace via sync push, then measures
// concurrent device sync, full pull, snapshot, change log (JSON export) and server search. Plain Node 22, no dependencies, so it also runs on the reference hosts (Raspberry Pi).
//
// Usage:
//   node scripts/loadtest/server-load.mjs                 # starts the PHP server (php -S)
//   BASE_URL=http://127.0.0.1:3000 node scripts/loadtest/server-load.mjs   # existing server
//
// Environment: PAGES (default 1000), BLOCKS_PER_PAGE (50), DEVICES (10), ROUNDS (20),
// OPS_PER_ROUND (50), SEARCHES (50), OUT (write the JSON result to this file).
// The issue's target size is PAGES=10000 (500k blocks); see docs/testing/load-tests.md.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = (name, fallback) => Number(process.env[name] ?? fallback)
const PAGES = env('PAGES', 1000)
const BLOCKS_PER_PAGE = env('BLOCKS_PER_PAGE', 50)
const DEVICES = env('DEVICES', 10)
const ROUNDS = env('ROUNDS', 20)
const OPS_PER_ROUND = env('OPS_PER_ROUND', 50)
const SEARCHES = env('SEARCHES', 50)
const SNAPSHOT_PAGE = env('SNAPSHOT_PAGE', 2000)
const BATCH = 500 // SYNC_PUSH_MAX_OPERATIONS
const PASSWORD = 'load test password 123'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
let baseUrl = process.env.BASE_URL
let server = null
let workDir = null

// ---------------------------------------------------------------------------------------------
// Deterministic content: pseudo-random words so runs are comparable.

let seed = 42
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const WORDS = (
  'projekt plan notiz aufgabe idee besprechung entwurf kunde rechnung server backup sync ' +
  'garten reise rezept buch film musik code fehler test release woche monat jahr team ' +
  'offline lokal export import seite block liste frage antwort termin budget ziel'
).split(' ')
const sentence = (n) =>
  Array.from({ length: n }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ')

// ---------------------------------------------------------------------------------------------
// HTTP with timing.

let cookie = ''
const timings = new Map()
function record(name, ms) {
  if (!timings.has(name)) timings.set(name, [])
  timings.get(name).push(ms)
}

async function request(name, method, path, body) {
  const started = performance.now()
  const response = await fetch(baseUrl + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const ms = performance.now() - started
  if (name) record(name, ms)
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`)
  const setCookie = response.headers.get('set-cookie')
  if (setCookie?.startsWith('session=')) cookie = setCookie.split(';')[0]
  return { json: text ? JSON.parse(text) : null, bytes: text.length, ms }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const round = (v) => Math.round(v * 10) / 10
  return {
    count: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1)),
    total: round(sorted.reduce((a, b) => a + b, 0)),
  }
}

// ---------------------------------------------------------------------------------------------
// Resource sampling: /proc of the server this script started and its worker processes (php -S
// forks PHP_CLI_SERVER_WORKERS children). A server given by BASE_URL is not sampled.

const samples = []
let lastCpu = null
function readProc(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
    let ticks = Number(stat[11]) + Number(stat[12]) // utime + stime
    let rss = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim()
    for (const child of children ? children.split(' ') : []) {
      const sub = readProc(Number(child))
      if (sub) {
        ticks += sub.ticks
        rss += sub.rss
      }
    }
    return { ticks, rss }
  } catch {
    return null
  }
}
async function sample(phase) {
  if (server) {
    const now = performance.now()
    const proc = readProc(server.pid)
    if (!proc) return
    let cpu = null
    if (lastCpu) cpu = ((proc.ticks - lastCpu.ticks) * 1000) / (now - lastCpu.at) // % of one core (10 ms ticks)
    lastCpu = { ticks: proc.ticks, at: now }
    samples.push({ phase, rssMb: proc.rss / 1e6, cpu })
  }
}
let currentPhase = 'start'
const sampler = setInterval(() => void sample(currentPhase), 250)

function phaseResources(phase) {
  const list = samples.filter((s) => s.phase === phase)
  if (!list.length) return null
  const cpus = list.map((s) => s.cpu).filter((c) => c !== null)
  return {
    peakRssMb: Math.round(Math.max(...list.map((s) => s.rssMb))),
    avgCpuPct: cpus.length ? Math.round(cpus.reduce((a, b) => a + b, 0) / cpus.length) : null,
  }
}

async function databaseSize() {
  if (!workDir) return null
  try {
    const { statSync } = await import('node:fs')
    const size = (f) => {
      try {
        return statSync(join(workDir, f)).size
      } catch {
        return 0
      }
    }
    return Math.round((size('app.db') + size('app.db-wal')) / 1e6)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------

async function startServer() {
  workDir = mkdtempSync(join(tmpdir(), 'notion-alt-load-'))
  const port = 3900 + Math.floor(Math.random() * 90)
  baseUrl = `http://127.0.0.1:${port}`
  // PHP's built-in web server with several workers.
  server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/index.php'], {
    cwd: join(root, 'apps/server'),
    env: {
      ...process.env,
      PHP_CLI_SERVER_WORKERS: '8',
      DATA_DIR: workDir,
      DATABASE_PATH: join(workDir, 'app.db'),
      LOG_LEVEL: 'warn',
      METRICS_ENABLED: 'true',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${baseUrl}/api/ready`)).ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not become ready')
}

function op(deviceId, workspaceId, entity, kind, entityId, payload, baseRevision = null) {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity,
    entityId,
    kind,
    baseRevision,
    payload,
    createdAt: new Date().toISOString(),
  }
}

async function phase(name, fn) {
  currentPhase = name
  process.stderr.write(`· ${name} …\n`)
  const started = performance.now()
  const result = await fn()
  const seconds = Math.round((performance.now() - started) / 100) / 10
  await sample(name)
  return { seconds, ...result, resources: phaseResources(name) }
}

async function main() {
  if (!baseUrl) await startServer()
  const results = { config: { PAGES, BLOCKS_PER_PAGE, DEVICES, ROUNDS, OPS_PER_ROUND }, phases: {} }

  const email = `load-${Date.now()}@example.com`
  await request(null, 'POST', '/api/auth/register', { email, password: PASSWORD })
  const workspaceId = (await request(null, 'GET', '/api/workspaces')).json.workspaces[0].id
  const devices = []
  for (let i = 0; i < DEVICES; i++) {
    const id = randomUUID()
    await request(null, 'POST', '/api/devices', { id, name: `Load ${i}` })
    devices.push(id)
  }

  // 1. Seed through the normal sync path: full batches of 500 operations (largest push).
  const blocks = [] // { id, revision }
  const blockById = new Map()
  const pages = []
  let seedCursor = 0
  results.phases.seed = await phase('seed', async () => {
    let batch = []
    let operations = 0
    const flush = async () => {
      if (!batch.length) return
      const { json } = await request('push_batch_500', 'POST', '/api/sync/push', {
        operations: batch,
      })
      for (const [i, result] of json.results.entries()) {
        if (!['applied', 'duplicate'].includes(result.status)) {
          throw new Error(`seed op rejected: ${JSON.stringify(result)}`)
        }
        seedCursor = Math.max(seedCursor, result.seq)
        if (batch[i].entity === 'block') {
          const block = { id: batch[i].entityId, revision: result.revision }
          blocks.push(block)
          blockById.set(block.id, block)
        }
      }
      operations += batch.length
      batch = []
    }
    for (let p = 0; p < PAGES; p++) {
      const pageId = randomUUID()
      pages.push(pageId)
      // A shallow tree: every tenth page is a root, the others its children.
      const parentId = p % 10 === 0 ? null : pages[p - (p % 10)]
      batch.push(
        op(devices[0], workspaceId, 'document', 'create', pageId, {
          parentId,
          title: `Seite ${p} ${sentence(3)}`,
          sortKey: `a${String(p).padStart(6, '0')}`,
          favorite: false,
          createdAt: new Date().toISOString(),
        }),
      )
      for (let b = 0; b < BLOCKS_PER_PAGE; b++) {
        if (batch.length >= BATCH) await flush()
        batch.push(
          op(devices[0], workspaceId, 'block', 'create', randomUUID(), {
            documentId: pageId,
            type: b === 0 ? 'heading' : 'paragraph',
            content: sentence(12 + Math.floor(random() * 20)),
            attrs: b === 0 ? { level: 1 } : {},
            sortKey: `a${String(b).padStart(4, '0')}`,
          }),
        )
        if (batch.length >= BATCH) await flush()
      }
      if (batch.length >= BATCH) await flush()
    }
    await flush()
    const t = stats(timings.get('push_batch_500'))
    return {
      operations,
      opsPerSecond: Math.round(operations / (t.total / 1000)),
      batchMs: t,
      databaseMb: await databaseSize(),
    }
  })

  // 2. Many devices syncing at once: each pushes block updates, then pulls what it missed.
  results.phases.concurrentSync = await phase('concurrent-sync', async () => {
    let next = 0
    const errors = []
    const statuses = {}
    await Promise.all(
      devices.map(async (deviceId, d) => {
        // Start at the end of the seeded log like an up-to-date device.
        let cursor = seedCursor
        for (let r = 0; r < ROUNDS; r++) {
          const ops = []
          for (let i = 0; i < OPS_PER_ROUND; i++) {
            const block = blocks[next++ % blocks.length]
            ops.push(
              op(
                deviceId,
                workspaceId,
                'block',
                'update',
                block.id,
                { content: `${sentence(8)} d${d}r${r}` },
                block.revision,
              ),
            )
          }
          try {
            const { json } = await request('push_concurrent', 'POST', '/api/sync/push', {
              operations: ops,
            })
            json.results.forEach((result, i) => {
              statuses[result.status] = (statuses[result.status] ?? 0) + 1
              if (result.revision) {
                const block = blockById.get(ops[i].entityId)
                if (block) block.revision = result.revision
              }
            })
            let more = true
            while (more) {
              const pull = await request(
                'pull_concurrent',
                'GET',
                `/api/sync/pull?workspaceId=${workspaceId}&cursor=${cursor}&limit=1000`,
              )
              cursor = pull.json.cursor
              more = pull.json.hasMore
            }
          } catch (error) {
            errors.push(String(error.message).slice(0, 200))
          }
        }
      }),
    )
    return {
      push: stats(timings.get('push_concurrent') ?? [0]),
      pull: stats(timings.get('pull_concurrent') ?? [0]),
      statuses,
      errors: errors.slice(0, 5),
      errorCount: errors.length,
    }
  })

  // 3. New device: full delta pull from cursor 0.
  results.phases.fullPull = await phase('full-pull', async () => {
    let cursor = 0
    let changes = 0
    let bytes = 0
    let more = true
    while (more) {
      const page = await request(
        'pull_page',
        'GET',
        `/api/sync/pull?workspaceId=${workspaceId}&cursor=${cursor}&limit=1000`,
      )
      changes += page.json.changes.length
      bytes += page.bytes
      cursor = page.json.cursor
      more = page.json.hasMore
    }
    return { changes, megabytes: Math.round(bytes / 1e6), pageMs: stats(timings.get('pull_page')) }
  })

  // 4. Re-sync: snapshot page by page with a fixed cursor (#97), as the web app requests it.
  results.phases.snapshot = await phase('snapshot', async () => {
    const started = performance.now()
    let after = null
    let bytes = 0
    let pages = 0
    const counts = { documents: 0, blocks: 0 }
    do {
      const query = new URLSearchParams({ workspaceId, limit: String(SNAPSHOT_PAGE) })
      if (after) query.set('after', after)
      const page = await request('snapshot_page', 'GET', `/api/sync/snapshot?${query}`)
      bytes += page.bytes
      pages++
      counts.documents += page.json.documents.length
      counts.blocks += page.json.blocks.length
      after = page.json.next
    } while (after)
    return {
      ms: Math.round(performance.now() - started),
      megabytes: Math.round(bytes / 1e6),
      pages,
      pageMs: stats(timings.get('snapshot_page')),
      ...counts,
    }
  })

  // 4a. New device in "on demand" mode (ADR 0017): snapshot without blocks, then every page in
  // batches of 100 ("Alles offline verfügbar machen").
  results.phases.onDemand = await phase('on-demand', async () => {
    const started = performance.now()
    let after = null
    let bytes = 0
    const ids = []
    do {
      const query = new URLSearchParams({
        workspaceId,
        limit: String(SNAPSHOT_PAGE),
        content: 'false',
      })
      if (after) query.set('after', after)
      const page = await request('snapshot_lean_page', 'GET', `/api/sync/snapshot?${query}`)
      bytes += page.bytes
      ids.push(...page.json.documents.map((d) => d.id))
      after = page.json.next
    } while (after)
    const treeMs = Math.round(performance.now() - started)
    const treeMegabytes = Math.round((bytes / 1e6) * 10) / 10
    let blocks = 0
    for (let i = 0; i < ids.length; i += 100) {
      const page = await request('documents_batch', 'POST', '/api/sync/documents', {
        workspaceId,
        ids: ids.slice(i, i + 100),
      })
      bytes += page.bytes
      blocks += page.json.pages.reduce((sum, p) => sum + p.blocks.length, 0)
    }
    return {
      treeMs,
      treeMegabytes,
      documents: ids.length,
      allPagesMs: Math.round(performance.now() - started),
      megabytes: Math.round(bytes / 1e6),
      blocks,
      batchMs: stats(timings.get('documents_batch') ?? [0]),
    }
  })

  // 4b. Optional: the old single-response snapshot (clients before #97), for comparison.
  if (process.env.LEGACY_SNAPSHOT === '1') {
    results.phases.snapshotLegacy = await phase('snapshot-legacy', async () => {
      const { json, bytes, ms } = await request(
        'snapshot',
        'GET',
        `/api/sync/snapshot?workspaceId=${workspaceId}`,
      )
      return {
        ms: Math.round(ms),
        megabytes: Math.round(bytes / 1e6),
        documents: json.documents?.length,
        blocks: json.blocks?.length,
      }
    })
  }

  // 5. JSON export reads the whole change log (ADR 0004).
  results.phases.exportLog = await phase('export-log', async () => {
    let cursor = 0
    let changes = 0
    let more = true
    while (more) {
      const page = await request(
        'log_page',
        'GET',
        `/api/sync/log?workspaceId=${workspaceId}&cursor=${cursor}&limit=1000`,
      )
      changes += page.json.changes.length
      cursor = page.json.cursor
      more = page.json.hasMore
    }
    return { changes, pageMs: stats(timings.get('log_page')) }
  })

  // 6. Server-side search (FTS5).
  results.phases.search = await phase('search', async () => {
    for (let i = 0; i < SEARCHES; i++) {
      const q =
        i % 2
          ? WORDS[i % WORDS.length]
          : `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]}`
      await request(
        'search',
        'GET',
        `/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent(q)}`,
      )
    }
    return { queryMs: stats(timings.get('search')) }
  })

  results.databaseMb = await databaseSize()
  return results
}

try {
  const results = await main()
  const output = JSON.stringify(results, null, 2)
  if (process.env.OUT) writeFileSync(process.env.OUT, output + '\n')
  console.log(output)
} finally {
  clearInterval(sampler)
  server?.kill()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
}
