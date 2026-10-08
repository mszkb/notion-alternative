import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const API_PORT = 3100
const WEB_PORT = 5180
// Production build (service worker) for the PWA tests.
const PREVIEW_PORT = 5181
const databasePath = path.join(tmpdir(), `notion-alt-e2e-${Date.now()}.sqlite`)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /pwa-.*\.spec\.ts/ },
    {
      name: 'pwa',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium in new headless mode: the default headless shell has no notifications
        // and no push, so the push tests could never pass there.
        channel: 'chromium',
        baseURL: `http://localhost:${PREVIEW_PORT}`,
      },
      testMatch: /pwa-.*\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // The PHP server (ADR 0018); SERVER_CMD runs another one from the repository root, like the
      // contract tests: the port comes as PORT, `{port}` in the command is replaced by it.
      command: (
        process.env.SERVER_CMD ||
        'php -S 127.0.0.1:{port} -t apps/server-php/public apps/server-php/public/index.php'
      ).replaceAll('{port}', String(API_PORT)),
      cwd: '../..',
      url: `http://127.0.0.1:${API_PORT}/api/ready`,
      // Every test (and retry) registers its own account, so attempts never share server data.
      env: {
        PORT: String(API_PORT),
        // Parallel requests for PHP's built-in server.
        PHP_CLI_SERVER_WORKERS: '4',
        DATABASE_PATH: databasePath,
        LOG_LEVEL: 'warn',
        ALLOW_REGISTRATION: 'true',
        // Every test registers from the same address; keep the per-IP limit out of the way.
        REGISTER_MAX_ATTEMPTS_PER_IP: '100000',
        // Fake push service used by the PWA tests.
        PUSH_ALLOWED_HOSTS: 'push.test',
        // Small per-workspace attachment quota for the limit test (each test has its own account).
        WORKSPACE_STORAGE_MB: '0.05',
      },
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
    },
  ],
})
