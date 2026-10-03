import path from 'node:path'
import { z } from 'zod'

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATA_DIR: z.string().default('./data'),
  DATABASE_PATH: z.string().optional(),
  // Registration is always possible for the very first account; afterwards only if enabled.
  ALLOW_REGISTRATION: booleanFromEnv.default(false),
  COOKIE_SECURE: booleanFromEnv.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  METRICS_ENABLED: booleanFromEnv.default(false),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().min(1).default(20),
  LOGIN_MAX_FAILURES_PER_EMAIL: z.coerce.number().int().min(1).default(5),
  REGISTER_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().min(1).default(10),
  // VAPID contact (RFC 8292); some push services reject placeholder addresses.
  PUSH_SUBJECT: z.string().default('mailto:admin@localhost'),
  ATTACHMENTS_DIR: z.string().optional(),
  ATTACHMENT_MAX_MB: z.coerce.number().min(1).max(1024).default(25),
  ATTACHMENT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
  // Total attachment storage per workspace; 0 = no limit (operator setting, no paywall).
  WORKSPACE_STORAGE_MB: z.coerce.number().min(0).default(2048),
  // Push services the server may send to (subscription endpoints come from clients: no SSRF).
  PUSH_ALLOWED_HOSTS: z
    .string()
    .default(
      'fcm.googleapis.com,updates.push.services.mozilla.com,*.push.apple.com,*.notify.windows.com',
    ),
})

export interface Config {
  host: string
  port: number
  logLevel: string
  databasePath: string
  allowRegistration: boolean
  cookieSecure: boolean
  sessionTtlDays: number
  metricsEnabled: boolean
  attachments: {
    dir: string
    maxBytes: number
    /** Days a deleted attachment's file is kept (restore, conflicts). */
    retentionDays: number
    /** Total size of a workspace's attachments; null = unlimited. */
    workspaceQuotaBytes: number | null
  }
  push: {
    subject: string
    /** Host names; `*.` allows subdomains. */
    allowedHosts: string[]
  }
  authRateLimit: {
    windowMinutes: number
    loginMaxFailuresPerIp: number
    loginMaxFailuresPerEmail: number
    registerMaxAttemptsPerIp: number
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env)
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databasePath: parsed.DATABASE_PATH ?? path.join(parsed.DATA_DIR, 'app.sqlite'),
    allowRegistration: parsed.ALLOW_REGISTRATION,
    cookieSecure: parsed.COOKIE_SECURE,
    sessionTtlDays: parsed.SESSION_TTL_DAYS,
    metricsEnabled: parsed.METRICS_ENABLED,
    attachments: {
      dir: parsed.ATTACHMENTS_DIR ?? path.join(parsed.DATA_DIR, 'attachments'),
      // Decimal megabytes, like the browsers' storage pages and the app's display.
      maxBytes: Math.round(parsed.ATTACHMENT_MAX_MB * 1_000_000),
      retentionDays: parsed.ATTACHMENT_RETENTION_DAYS,
      workspaceQuotaBytes:
        parsed.WORKSPACE_STORAGE_MB > 0
          ? Math.round(parsed.WORKSPACE_STORAGE_MB * 1_000_000)
          : null,
    },
    push: {
      subject: parsed.PUSH_SUBJECT,
      allowedHosts: parsed.PUSH_ALLOWED_HOSTS.split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    },
    authRateLimit: {
      windowMinutes: parsed.AUTH_RATE_LIMIT_WINDOW_MINUTES,
      loginMaxFailuresPerIp: parsed.LOGIN_MAX_FAILURES_PER_IP,
      loginMaxFailuresPerEmail: parsed.LOGIN_MAX_FAILURES_PER_EMAIL,
      registerMaxAttemptsPerIp: parsed.REGISTER_MAX_ATTEMPTS_PER_IP,
    },
  }
}
