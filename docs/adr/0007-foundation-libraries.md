# 0007 – Bibliotheken und Konventionen für Phase 1

- **Status:** Accepted, Server-Teil superseded by 0018
- **Datum:** 2026-10-02


> **Teilweise ersetzt:** Der Teil „Server-Bibliotheken (Fastify-Umfeld, Kysely, better-sqlite3)“ ist durch [ADR 0018](0018-php-backend.md) (PHP-Backend, angenommen 2026-10-08) ersetzt. Bis zur Umstellung ([#129](https://github.com/mszkb/notion-alternative/issues/129)) läuft weiter der Node-Server.

## Kontext

[ADR 0006](0006-tech-stack.md) legt den Stack fest und überlässt die Wahl der konkreten Bibliotheken Phase 1. Ziel: wenige, verbreitete Abhängigkeiten; der Datenzugriff soll einen späteren Wechsel auf PostgreSQL erlauben.

## Entscheidung

| Bereich | Wahl | Begründung |
| --- | --- | --- |
| Monorepo | **pnpm Workspaces** (`apps/server`, `apps/web`, `packages/shared`) | Schnell, strikte Abhängigkeiten, `pnpm deploy` für schlanke Images |
| SQLite-Treiber | **better-sqlite3** (vorgebaute Binaries, kein Compiler im Image) | Ausgereift, synchron und schnell; `node:sqlite` ist in Node 22 noch experimentell |
| Query-Builder & Migrationen | **Kysely** | Typsicher, unterstützt SQLite **und** PostgreSQL; Migrationen statisch registriert (bündelbar) |
| Validierung & geteilte Typen | **zod** in `packages/shared` | Dieselben Schemas validieren im Server und typisieren den Client |
| Server-Build | **esbuild** bündelt Server + `shared` nach `dist/`, npm-Abhängigkeiten bleiben extern; `tsx` für Dev | `shared` braucht keinen eigenen Build-Schritt |
| Tests | **Vitest**; Server-Tests per `fastify.inject` gegen SQLite `:memory:` | Schnell, kein laufender Server nötig |
| Lint/Format | **ESLint** (typescript-eslint, eslint-plugin-vue) + **Prettier** | Standard im Vue/TS-Umfeld |
| TypeScript | **6.0** | typescript-eslint unterstützt TS 7 noch nicht |
| Frontend-Container | **nginx**: liefert die SPA aus, leitet `/api` an `backend` weiter | Gleicher Origin für Cookies und Service Worker |
| Logs | Fastify/pino, JSON auf stdout | Von Docker direkt einsammelbar |

### Authentifizierung

- Session-Cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` per `COOKIE_SECURE`), Token zufällig (256 Bit); in der DB liegt nur der SHA-256-Hash.
- Passwörter mit **scrypt** aus `node:crypto` (N=2^15, r=8, p=1), Mindestlänge 10 Zeichen.
- **Registrierung:** Das erste Konto kann sich immer registrieren; danach nur, wenn `ALLOW_REGISTRATION=true`. Damit ist eine frisch installierte, öffentlich erreichbare Instanz nicht für jeden offen.
- Bei der Registrierung wird ein Workspace „Personal“ angelegt.
- Workspace-Grenze: Zugriff nur für den Owner; fremde Workspaces liefern `404` statt `403`.

## Konsequenzen

- Für Offline-Nutzung ist wichtig: Die Session ist 30 Tage gültig (`SESSION_TTL_DAYS`). Ein abgelaufenes Login darf später (Phase 3) nie den lokalen Zugriff blockieren, nur den Sync.
- Noch nicht umgesetzt: Rate Limiting für Login, Passwort ändern/zurücksetzen, Metriken-Endpunkt. Diese Punkte sind in der Roadmap vermerkt.
- PostgreSQL-Wechsel: Kysely-Dialekt tauschen, Migrationen prüfen (SQLite-spezifische Typen vermeiden).
