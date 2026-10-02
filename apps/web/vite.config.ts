import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // Same-origin API in development, mirroring the nginx proxy in production.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
