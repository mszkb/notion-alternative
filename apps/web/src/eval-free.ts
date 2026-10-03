// Imported first in main.ts, before anything that defines schemas: zod decides whether to
// generate code (`new Function`) when a schema is created. The CSP forbids eval (#74).
import { config } from 'zod'

config({ jitless: true })
