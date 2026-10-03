import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { runClientLoad } from './load-scenario'

// Client load test in Node (#77), not part of `pnpm test`. fake-indexeddb is much slower than a
// browser's IndexedDB (index cursors are quadratic), so use `loadtest:browser` for real figures.

it('handles a large local workspace', async () => {
  const pages = Number(process.env.PAGES ?? 200)
  const result = await runClientLoad({
    pages,
    blocksPerPage: Number(process.env.BLOCKS_PER_PAGE ?? 50),
    heapMb: () => {
      ;(globalThis as { gc?: () => void }).gc?.()
      return Math.round(process.memoryUsage().heapUsed / 1e6)
    },
  })
  const output = JSON.stringify(result, null, 2)
  process.stdout.write(output + '\n')
  if (process.env.OUT) writeFileSync(process.env.OUT, output + '\n')
  expect(result.documents).toBe(pages)
  expect(result.indexed).toBe(pages)
})
