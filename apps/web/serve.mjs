// Frontend server without Docker: serves the built SPA (dist/) and proxies /api to the backend.
// Mirrors nginx.conf (cache rules, security headers, SPA fallback); no dependencies beyond Node.
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** `add_header Name "value" always;` lines of the nginx snippet, shared with nginx and vite preview. */
export function readSecurityHeaders(file = path.join(here, 'security-headers.conf')) {
  const conf = readFileSync(file, 'utf8')
  return Object.fromEntries(
    [...conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;$/gm)].map((m) => [m[1], m[2]]),
  )
}

/** Cache-Control per path, as in nginx.conf; `strict` paths get a 404 instead of the SPA fallback. */
function cacheRule(pathname) {
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest')
    return { cacheControl: 'no-cache', strict: true }
  if (pathname.startsWith('/icons/')) return { cacheControl: 'public, max-age=86400', strict: true }
  if (pathname.startsWith('/assets/'))
    return { cacheControl: 'public, max-age=31536000, immutable', strict: true }
  return { cacheControl: 'no-cache', strict: false }
}

async function fileAt(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const file = path.resolve(root, '.' + decoded)
  // Never leave the build directory (`/../`, encoded slashes, …).
  if (file !== root && !file.startsWith(root + path.sep)) return null
  try {
    return (await stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

function sendFile(req, res, file, headers) {
  res.writeHead(200, {
    ...headers,
    'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream',
  })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
}

function proxy(req, res, backend, securityHeaders) {
  const forwardedFor = [req.headers['x-forwarded-for'], req.socket.remoteAddress]
    .filter(Boolean)
    .join(', ')
  const upstream = http.request(
    {
      hostname: backend.hostname,
      port: backend.port || 80,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, 'x-forwarded-for': forwardedFor, 'x-forwarded-proto': 'http' },
    },
    (upstreamRes) => {
      const headers = { ...upstreamRes.headers }
      for (const [name, value] of Object.entries(securityHeaders))
        headers[name.toLowerCase()] ??= value
      res.writeHead(upstreamRes.statusCode ?? 502, headers)
      upstreamRes.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('backend unavailable\n')
  })
  req.pipe(upstream)
}

/**
 * @param {{ root: string, backend: string, securityHeaders?: Record<string, string> }} options
 */
export function createFrontendServer({ root, backend, securityHeaders = readSecurityHeaders() }) {
  const rootDir = path.resolve(root)
  const backendUrl = new URL(backend)

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')

    if (pathname === '/healthz') {
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/plain' })
      return res.end('ok\n')
    }
    // Metrics are for internal scraping only (docs/operations/deployment.md).
    if (pathname === '/api/metrics') {
      res.writeHead(404, securityHeaders)
      return res.end()
    }
    if (pathname.startsWith('/api/')) return proxy(req, res, backendUrl, securityHeaders)

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...securityHeaders, Allow: 'GET, HEAD' })
      return res.end()
    }
    const rule = cacheRule(pathname)
    const headers = { ...securityHeaders, 'Cache-Control': rule.cacheControl }
    const file = await fileAt(rootDir, pathname)
    if (file) return sendFile(req, res, file, headers)
    if (rule.strict) {
      res.writeHead(404, securityHeaders)
      return res.end()
    }
    // SPA fallback; index.html is not cached so new releases are picked up.
    sendFile(req, res, path.join(rootDir, 'index.html'), {
      ...headers,
      'Cache-Control': 'no-cache',
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.WEB_ROOT ?? path.join(here, 'dist')
  if (!existsSync(path.join(root, 'index.html'))) {
    console.error(`No build found in ${root}. Run "pnpm build" first.`)
    process.exit(1)
  }
  const host = process.env.HOST ?? '127.0.0.1'
  const port = Number(process.env.PORT ?? 8080)
  const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000'
  createFrontendServer({ root, backend }).listen(port, host, () => {
    console.log(`App: http://${host}:${port} (API: ${backend})`)
  })
}
