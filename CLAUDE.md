# CLAUDE.md

Leitfaden für Claude Code (und andere Agents) in diesem Repository.

## Projekt in einem Satz

Self-hosted, **local-first / offline-first** Wissens- und Dokumentenplattform (Notion-Alternative) mit installierbarer PWA. Daten bleiben auf dem Gerät nutzbar, auch wenn Server oder Internet ausfallen.

## Status

Phase 0 abgeschlossen, Phase 1 (Foundation) weitgehend umgesetzt: Monorepo, Server mit Auth und Workspaces, SPA-Grundgerüst, Docker Compose, CI. Entscheidungen werden als ADRs in `docs/adr/` getroffen. Keine Frameworks/Abhängigkeiten einführen, deren ADR noch auf `Proposed` steht, ohne Rücksprache.

Entschieden (`Accepted`):

- **Stack** ([ADR 0006](docs/adr/0006-tech-stack.md)): TypeScript; Vue 3 SPA (Vite, ohne Nuxt); Fastify; SQLite (Server, inkl. FTS5); Dateien im Volume, S3 später; Docker Compose mit 2 Containern (`frontend`, `backend`).
- **Lokale DB** ([ADR 0001](docs/adr/0001-local-storage.md)): IndexedDB über Dexie.
- **Konflikte** ([ADR 0003](docs/adr/0003-conflict-resolution.md)): Block-Merge + sichtbare Konfliktanzeige.
- **Sync** ([ADR 0002](docs/adr/0002-sync-protocol.md)): REST-Batch (`/api/sync/push`, `/pull`, `/snapshot`), Operationen auf Blockebene.
- **Export** ([ADR 0004](docs/adr/0004-export-format.md)): Markdown mit relativen Links, JSON inkl. Verlauf, ZIP mit Manifest.
- **Push** ([ADR 0005](docs/adr/0005-push.md)): VAPID vom eigenen Server, Payload ohne Inhalte.
- **Bibliotheken** ([ADR 0007](docs/adr/0007-foundation-libraries.md)): pnpm, Kysely + better-sqlite3, zod, esbuild, Vitest, ESLint + Prettier, nginx.

Noch offen in Phase 0: Zielgruppe schärfen.

## Wo steht was

| Datei / Ordner | Inhalt |
| --- | --- |
| `ROADMAP.md` | Phasen 0–9, Milestones, Fortschritt (Checklisten) |
| `docs/product/` | Vision, Zielgruppen, Prinzipien, MVP-Scope, Nicht-Ziele, Akzeptanzkriterien |
| `docs/architecture/` | Architekturüberblick, Datenmodell & Sync, Push-Strategie |
| `docs/adr/` | Architecture Decision Records (Vorlage: `0000-template.md`) |
| `docs/process/` | Definition of Done, Aufgabenzerlegung für den Roadmap-Agenten |
| `docs/testing/` | Testmatrix (offline/online, Mehrgeräte, Konflikte, Backups, Migrationen) |

Bei Fragen zu Scope oder Architektur zuerst dort nachlesen, nicht raten.

## Nicht verhandelbare Produktprinzipien

Jede Änderung muss diese Prinzipien einhalten. Wenn eine Aufgabe dagegen verstößt, darauf hinweisen statt sie umzusetzen.

1. **Local-first:** Die lokale Datenbank ist jederzeit lesbar und bearbeitbar.
2. **Offline-first:** Serverausfall verhindert nie den Zugriff auf lokal vorhandene Inhalte.
3. **Export first:** Markdown-, JSON- und ZIP-Export müssen verlässlich funktionieren und wieder importierbar sein.
4. **Push ist nur ein Hinweis:** Datenintegrität darf nie von Push-Zustellung abhängen. Sync läuft auch bei Start, Fokuswechsel und periodisch.
5. **Keine künstlichen Feature-Sperren** für Self-hosted Einzelanwender.
6. **Keine stillen Überschreibungen:** Kein verstecktes Last-write-wins. Konflikte werden auf Blockebene gemerged oder sichtbar zur Entscheidung angezeigt.

## Sync-Invarianten (bei jeder Sync-relevanten Änderung prüfen)

- Jede lokale Änderung hat eine eindeutige Operation-ID und wird **idempotent** übertragen.
- Löschungen erzeugen **Tombstones**.
- Delta-Sync über Cursor; ein **vollständiger Re-Sync** muss immer möglich sein.
- Push-Payload enthält **keine Inhalte**, nur `sync_available` + Workspace-/Installationsreferenz (+ optional Badge).

Details: `docs/architecture/sync.md`, `docs/architecture/push.md`.

## Nicht im MVP

Relationale Datenbanken mit vielen Views, Echtzeit-Kollaboration/Cursor-Präsenz, Whiteboard/Kalender/PM, KI-Assistent, Template-Galerie, Enterprise-SSO/SCIM/Audit-Logs, native iOS-App. Solche Features nicht ungefragt bauen; ggf. als Idee für spätere Phasen notieren.

## Arbeitsweise

- **Sprache:** Dokumentation und Issues auf Deutsch. Code, Bezeichner, Commit-Messages und Code-Kommentare auf Englisch.
- **Architekturentscheidungen** immer als ADR festhalten (`docs/adr/NNNN-titel.md`, Status `Proposed` → `Accepted`/`Rejected`/`Superseded`).
- **Roadmap pflegen:** Erledigte Punkte in `ROADMAP.md` abhaken; Scope-Änderungen in `docs/product/` nachziehen.
- **Definition of Done** (`docs/process/definition-of-done.md`) gilt für jede Aufgabe: Tests, Security, Doku, reproduzierbares Deployment.
- Sync-, Konflikt- und Export-Code braucht Tests für die Fälle aus `docs/testing/test-matrix.md`.
- Kleine, fokussierte Commits; keine unbeteiligten Refactorings mitliefern.

## Befehle

Node 22 und pnpm (`corepack enable`).

| Befehl | Zweck |
| --- | --- |
| `pnpm install` | Abhängigkeiten installieren |
| `pnpm dev` | Server (`:3000`) und Vite (`:5173`, Proxy `/api`) im Watch-Modus |
| `pnpm lint` / `pnpm format:check` | ESLint / Prettier (`pnpm format` korrigiert) |
| `pnpm typecheck` | `tsc` bzw. `vue-tsc` in allen Paketen |
| `pnpm test` | Vitest in allen Paketen |
| `pnpm build` | Server-Bundle und SPA bauen |
| `docker compose up -d --build` | Produktiv-Stack auf `:8080` |

Struktur: `apps/server` (Fastify), `apps/web` (Vue SPA), `packages/shared` (zod-Schemas/Typen für beide).

- Neue DB-Migration: Datei in `apps/server/src/db/migrations/` anlegen **und** in `src/db/migrate.ts` registrieren; Migrationen nie nachträglich ändern.
- Eingaben im Server immer mit `parseInput(schema, …)` und Schemas aus `@notion-alt/shared` validieren.
- Workspace-Daten immer über Funktionen abfragen, die die User-ID einschränken (`findWorkspaceForUser`).
- Betrieb, Konfiguration, Backup: `docs/operations/deployment.md`.
