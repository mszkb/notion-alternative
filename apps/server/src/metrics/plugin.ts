import { statSync } from 'node:fs'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { FastifyInstance } from 'fastify'
import { PROMETHEUS_CONTENT_TYPE, Registry } from './registry'

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

function fileSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Collects HTTP, process and database metrics into `app.metrics`.
 *
 * Registered on the root instance so the hooks see every request. Other
 * modules (e.g. sync in phase 3) add their own metrics to `app.metrics`.
 */
export function setupMetrics(app: FastifyInstance, databasePath: string): void {
  const registry = new Registry()
  app.decorate('metrics', registry)

  const requests = registry.counter(
    'http_requests_total',
    'HTTP requests by method, route template and status code.',
  )
  const duration = registry.histogram(
    'http_request_duration_seconds',
    'HTTP request duration by method and route template.',
    DURATION_BUCKETS,
  )

  app.addHook('onResponse', async (request, reply) => {
    // Route template (e.g. /api/workspaces/:id), never the concrete path.
    const route = request.routeOptions.url ?? 'unmatched'
    const method = request.method
    requests.inc({ method, route, status: String(reply.statusCode) })
    duration.observe({ method, route }, reply.elapsedTime / 1000)
  })

  registry.gauge('process_resident_memory_bytes', 'Resident set size in bytes.', (g) =>
    g.set(process.memoryUsage().rss),
  )
  registry.gauge('process_heap_used_bytes', 'V8 heap used in bytes.', (g) =>
    g.set(process.memoryUsage().heapUsed),
  )
  registry.gauge('process_uptime_seconds', 'Process uptime in seconds.', (g) =>
    g.set(process.uptime()),
  )

  const loopDelay = monitorEventLoopDelay({ resolution: 20 })
  loopDelay.enable()
  registry.gauge(
    'nodejs_eventloop_lag_seconds',
    'Event loop delay since the previous scrape (quantiles).',
    (g) => {
      // Histogram values are nanoseconds; empty right after a reset.
      const ns = (value: number) => (Number.isFinite(value) ? value / 1e9 : 0)
      g.set(ns(loopDelay.mean), { quantile: 'mean' })
      g.set(ns(loopDelay.percentile(50)), { quantile: '0.5' })
      g.set(ns(loopDelay.percentile(99)), { quantile: '0.99' })
      g.set(ns(loopDelay.max), { quantile: 'max' })
      loopDelay.reset()
    },
  )
  app.addHook('onClose', async () => {
    loopDelay.disable()
  })

  registry.gauge('sqlite_file_size_bytes', 'Size of the SQLite database files in bytes.', (g) => {
    if (databasePath === ':memory:') return
    g.set(fileSize(databasePath), { file: 'db' })
    g.set(fileSize(`${databasePath}-wal`), { file: 'wal' })
  })
}

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', { logLevel: 'warn' }, async (_request, reply) =>
    reply.type(PROMETHEUS_CONTENT_TYPE).send(app.metrics.render()),
  )
}
