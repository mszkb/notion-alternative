import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./src/server.ts'],
    // One server for all files; files run one after another so rate limits stay predictable.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 90_000,
  },
})
