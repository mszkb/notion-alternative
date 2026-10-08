import { fileURLToPath } from 'node:url'

/** Repository root; SERVER_CMD runs there. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Self-signed certificate of the fake push service (also its own CA). */
export const PUSH_RECEIVER_CERT = fileURLToPath(
  new URL('../fixtures/push-receiver.crt', import.meta.url),
)
export const PUSH_RECEIVER_KEY = fileURLToPath(
  new URL('../fixtures/push-receiver.key', import.meta.url),
)

/** Export fixtures of every released schema version (ADR 0004); never change them. */
export const EXPORT_FIXTURES = fileURLToPath(new URL('../fixtures/exports/', import.meta.url))

/**
 * The PHP server (ADR 0018) with PHP's built-in web server; curl must trust the fake push
 * service's certificate. Needs `composer install` in apps/server-php.
 */
export const DEFAULT_SERVER_CMD =
  'php -d curl.cainfo="$PUSH_RECEIVER_CA" -S 127.0.0.1:$PORT -t apps/server-php/public apps/server-php/public/index.php'

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

/**
 * Server settings the suite depends on. A started server gets exactly these; an external one
 * (SERVER_URL) must run with the same values. Each can be overridden through the variable of
 * the same name, for the suite and the started server alike.
 */
export const SERVER_SETTINGS = {
  ALLOW_REGISTRATION: 'true',
  METRICS_ENABLED: 'true',
  LOGIN_MAX_FAILURES_PER_EMAIL: fromEnv('LOGIN_MAX_FAILURES_PER_EMAIL', '3'),
  LOGIN_MAX_FAILURES_PER_IP: fromEnv('LOGIN_MAX_FAILURES_PER_IP', '6'),
  REGISTER_MAX_ATTEMPTS_PER_IP: fromEnv('REGISTER_MAX_ATTEMPTS_PER_IP', '4'),
  // Decimal megabytes: 1 MB per file, 3000 bytes per account.
  ATTACHMENT_MAX_MB: fromEnv('ATTACHMENT_MAX_MB', '1'),
  WORKSPACE_STORAGE_MB: fromEnv('WORKSPACE_STORAGE_MB', '0.003'),
  // The fake push service listens on 127.0.0.1 (any port).
  PUSH_ALLOWED_HOSTS: '127.0.0.1',
} as const

/** The limits as numbers, for assertions. */
export const LIMITS = {
  loginMaxFailuresPerEmail: Number(SERVER_SETTINGS.LOGIN_MAX_FAILURES_PER_EMAIL),
  loginMaxFailuresPerIp: Number(SERVER_SETTINGS.LOGIN_MAX_FAILURES_PER_IP),
  registerMaxAttemptsPerIp: Number(SERVER_SETTINGS.REGISTER_MAX_ATTEMPTS_PER_IP),
  attachmentMaxBytes: Math.round(Number(SERVER_SETTINGS.ATTACHMENT_MAX_MB) * 1_000_000),
  workspaceQuotaBytes: Math.round(Number(SERVER_SETTINGS.WORKSPACE_STORAGE_MB) * 1_000_000),
}
