import { defineConfig } from 'vitest/config'

/** Client load test (#77), kept out of `pnpm test`: `pnpm --filter @notion-alt/web loadtest`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.loadtest.ts'],
    testTimeout: 60 * 60 * 1000,
  },
})
