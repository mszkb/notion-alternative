import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { serviceWorker } from './service-worker.plugin.ts'

/** `add_header Name "value" always;` lines of the nginx snippet, for `vite preview`. */
function securityHeaders(): Record<string, string> {
  const conf = readFileSync(new URL('./security-headers.conf', import.meta.url), 'utf8')
  return Object.fromEntries(
    [...conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;$/gm)].map((m) => [m[1]!, m[2]!]),
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
