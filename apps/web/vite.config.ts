import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { serviceWorker } from './service-worker.plugin.ts'

/**
 * `add_header Name "value" always;` lines of the nginx snippet and the snippets it includes
 * (same folder here), for `vite preview`.
 */
function securityHeaders(file = 'security-headers.conf'): Record<string, string> {
  const conf = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
  const included = [...conf.matchAll(/^include\s+\S*\/([\w.-]+);$/gm)].map((m) =>
    securityHeaders(m[1]!),
  )
  return Object.assign(
    {},
    ...included,
    Object.fromEntries(
      [...conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;$/gm)].map((m) => [m[1]!, m[2]!]),
    ),
  )
}

export default defineConfig({
  plugins: [vue(), serviceWorker()],
  server: {
    port: 5173,
    // Same-origin API in development, mirroring the nginx proxy in production.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000' },
  },
  preview: { headers: securityHeaders() },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
