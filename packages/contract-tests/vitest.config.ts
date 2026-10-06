import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Starts the server under test (or uses SERVER_URL) and the fake push service.
    globalSetup: ['./src/global-setup.ts'],
    // Real HTTP against a real server; scrypt makes every sign-up take a moment.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
