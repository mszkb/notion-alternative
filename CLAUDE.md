# CLAUDE.md

Leitfaden für Claude Code (und andere Agents) in diesem Repository.

## Projekt in einem Satz

Self-hosted, **local-first / offline-first** Wissens- und Dokumentenplattform (Notion-Alternative) mit installierbarer PWA. Daten bleiben auf dem Gerät nutzbar, auch wenn Server oder Internet ausfallen.

## Status

Phase 0 abgeschlossen, Phase 1 (Foundation) umgesetzt: Monorepo, Server mit Auth (inkl. Login-Rate-Limiting, Passwort ändern) und Workspaces, Metriken, SPA-Grundgerüst, Docker Compose, CI. Phase 2 (Local editor) umgesetzt: lokale Dexie-Datenbank mit Offline-Queue, Block-Editor, Seitenbaum, Tags, Favoriten, Backlinks, lokale Suche; die App läuft ohne Server. Phase 3 (Sync) begonnen: Geräteverwaltung, serverseitiges Änderungslog (`apps/server/src/sync/`) Push der Offline-Queue, Delta-Pull, Tombstones, Re-Sync, Sync-Trigger (`apps/web/src/sync/`), Block-Merge mit Konfliktobjekten und Konfliktansicht, serverseitige Suche (FTS5). Phase 4 (PWA) umgesetzt (HTTPS: ADR 0011): Manifest, eigener Service Worker, Installationsflow, Web Push ohne Bibliothek. Phase 5 begonnen: Dateianhänge (ADR 0012). Entscheidungen werden als ADRs in `docs/adr/` getroffen. Keine Frameworks/Abhängigkeiten einführen, deren ADR noch auf `Proposed` steht, ohne Rücksprache.

Entschieden (`Accepted`):

- **Stack** ([ADR 0006](docs/adr/0006-tech-stack.md)): TypeScript; Vue 3 SPA (Vite, ohne Nuxt); SQLite (Server, inkl. FTS5); Dateien im Volume oder S3; Docker Compose mit 2 Containern (`frontend`, `backend`). Server-Teil (Fastify) ersetzt durch ADR 0018.
- **PHP-Backend** ([ADR 0018](docs/adr/0018-php-backend.md)): PHP 8.2+ mit Slim 4 in `apps/server-php` ist **der** Server (der Node-Server ist seit #129 entfernt); gleiches HTTP-API und dieselbe SQLite-Datei wie vorher; Webhosting (Release-ZIP) als Hauptweg, Docker (nginx + PHP-FPM) bleibt; Passwörter mit Argon2id (`password_hash`); die Contract-Tests sind die Spezifikation.
- **Lokale DB** ([ADR 0001](docs/adr/0001-local-storage.md)): IndexedDB über Dexie.
- **Konflikte** ([ADR 0003](docs/adr/0003-conflict-resolution.md)): Block-Merge + sichtbare Konfliktanzeige.
- **Sync** ([ADR 0002](docs/adr/0002-sync-protocol.md)): REST-Batch (`/api/sync/push`, `/pull`, `/snapshot`), Operationen auf Blockebene.
- **Export** ([ADR 0004](docs/adr/0004-export-format.md)): Markdown mit relativen Links, JSON inkl. Verlauf, ZIP mit Manifest.
- **Push** ([ADR 0005](docs/adr/0005-push.md)): VAPID vom eigenen Server, Payload ohne Inhalte.
- **Bibliotheken** ([ADR 0007](docs/adr/0007-foundation-libraries.md)): pnpm, zod, Vitest, ESLint + Prettier, nginx (Server-Bibliotheken ersetzt durch ADR 0018: Slim 4, slim/psr7; PHPUnit, PHPStan, PHP-CS-Fixer).
- **Editor** ([ADR 0008](docs/adr/0008-block-editor.md)): eigener Block-Editor (ein `contenteditable` pro Block); `Block.content` ist Markdown-Inline, Seitenlinks `[Titel](page:<uuid>)`, kursiv wird als `_x_` geschrieben.
- **Lokale Datenschicht** ([ADR 0009](docs/adr/0009-local-data-layer.md)): eine Dexie-DB pro Benutzer, Operationen in derselben Transaktion, Entität `document_tag`, Feldnamen camelCase, MiniSearch für die lokale Suche, Offline-Start mit zwischengespeichertem Benutzer.
- **Inhalte bei Bedarf** ([ADR 0017](docs/adr/0017-content-on-demand.md)): neue Geräte laden Seitenbaum und Metadaten, Seiteninhalte beim Öffnen; `unloadedDocuments` (Dexie v5) markiert fehlende Inhalte, „Alles offline verfügbar machen“ stellt auf `offlineMode = all`.
- **Referenz-Deployment** ([ADR 0010](docs/adr/0010-reference-deployment-and-https.md)): Linux-Host, App nur auf `127.0.0.1`, Zugriff per SSH-Tunnel (`localhost` = sicherer Kontext). CI baut die Images auch für `linux/arm64`. Kein dritter Container.
- **HTTPS für Smartphones** ([ADR 0011](docs/adr/0011-https-for-mobile-devices.md)): Home-Lab/Raspberry Pi per `tailscale serve`, sonst Webhosting bzw. vorhandener Reverse Proxy; keine Code-Änderung, `COOKIE_SECURE=true`.

Phase 0 abgeschlossen; Zielgruppe: Umsteiger von Notion, auch weniger technikaffine (`docs/product/vision.md`).

## Wo steht was

| Datei / Ordner | Inhalt |
| --- | --- |
| `ROADMAP.md` | Phasen 0–9, Milestones, Fortschritt (Checklisten) |
| `docs/product/` | Vision, Zielgruppen, Prinzipien, MVP-Scope, Nicht-Ziele, Akzeptanzkriterien, UX-Leitlinie (`ux-guide.md`) |
| `docs/architecture/` | Architekturüberblick, Datenmodell & Sync, Push-Strategie |
| `docs/adr/` | Architecture Decision Records (Vorlage: `0000-template.md`) |
| `docs/process/` | Definition of Done, Aufgabenzerlegung für den Roadmap-Agenten |
| `docs/testing/` | Testmatrix (offline/online, Mehrgeräte, Konflikte, Backups, Migrationen) |
| `docs/user/` | Anleitungen für Nutzer (App installieren, Seiten bearbeiten, Export und Import) |
| `docs/privacy/` | Datenschutz, z. B. Datenkatalog der Opt-in-Telemetrie |

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

## Autonomer Agent

Issues mit dem Label `ready` arbeitet ein lokaler Runner autonom ab (Ablauf, Labels, Grenzen: [`docs/process/autonomous-agent.md`](docs/process/autonomous-agent.md)).

- Für dieses Repo ist der Zugriff auf GitHub per `gh` erlaubt (Issues lesen/anlegen, Labels, Kommentare, PRs) – Ausnahme zur globalen Regel „kein Zugriff auf Repo-Hosting-APIs“.
- Im Agent-Lauf (Branch `agent/issue-<n>`): nur committen, nie pushen oder Labels ändern. Bei Unklarheit Rückfrage in `QUESTION.md` statt raten; Abschlussbericht in `REPORT.md`. Beide Dateien nie committen.

## Befehle

Node 22 und pnpm (`corepack enable`) für Web-App und Tests; PHP ≥ 8.2 mit Composer für den Server (`composer install` in `apps/server-php`).

| Befehl | Zweck |
| --- | --- |
| `pnpm install` | Abhängigkeiten installieren |
| `pnpm dev` | PHP-Server (`php -S`, `:3000`) und Vite (`:5173`, Proxy `/api`) |
| `pnpm lint` / `pnpm format:check` | ESLint / Prettier (`pnpm format` korrigiert) |
| `pnpm typecheck` | `tsc` bzw. `vue-tsc` in allen Paketen |
| `pnpm test` | Vitest in allen Paketen |
| `node scripts/loadtest/server-load.mjs`, `pnpm --filter @notion-alt/web loadtest:browser` | Lasttests Server/Client (`PAGES=10000` = Zielgröße), siehe `docs/testing/load-tests.md` |
| `pnpm --filter @notion-alt/contract-tests test` | HTTP-Contract-Tests (Spezifikation des Servers) gegen den PHP-Server (startet ihn selbst); anderer Server per `SERVER_CMD` oder `SERVER_URL`, nicht Teil von `pnpm test`, siehe `docs/testing/contract-tests.md` |
| `pnpm --filter @notion-alt/web test:e2e` | Playwright (startet Server + Vite selbst); lokal ohne Browser-Download: `PW_CHROMIUM_PATH=/pfad/zu/chromium` |
| `pnpm build` | SPA bauen |
| `scripts/build-php-release.sh` | Release-ZIP für Webhosting (SPA + `api/`), siehe `docs/user/webhosting.md` |
| `docker compose up -d --build` | Produktiv-Stack auf `:8080` |
| `composer test` / `analyse` / `cs` (in `apps/server-php`) | Server: PHPUnit, PHPStan (Level max), PHP-CS-Fixer; `bin/console` (Backup, Restore, Passwort) und `bin/cron.php`, siehe `apps/server-php/README.md` |

Struktur: `apps/server-php` (Server, Slim 4, ADR 0018), `apps/web` (Vue SPA), `packages/shared` (zod-Schemas/Typen, Markdown-Inline-Parser, Sortierschlüssel für beide), `packages/contract-tests` (HTTP-Black-Box-Tests der API gegen jeden Server).

Web-App: `src/local/` (Dexie-DB, `LocalStore`, Suche, Persistenz), `src/editor/` (Block-Editor, DOM↔Markdown), `src/layouts/`, `src/views/`, `src/components/`, `e2e/` (Playwright).

- Neue DB-Migration: Klasse in `apps/server-php/src/Database/Migrations/` anlegen, in `Migrator::all()` registrieren und das erwartete Schema im `MigratorTest` ergänzen (siehe `apps/server-php/README.md`); Migrationen nie nachträglich ändern. Die Tabelle `kysely_migration` bleibt Quelle des Migrationsstands.
- Lokale Inhalte nur über `LocalStore` schreiben (`apps/web/src/local/store.ts`): Er schreibt Entität und Operation in einer Transaktion. Dexie-Transaktions-Scopes müssen `async`-Funktionen sein, sonst committet Dexie bei nativen `await`s zu früh.
- Exportformat (`jsonExportSchema`) ändern: `EXPORT_SCHEMA_VERSION` erhöhen, Migration in `packages/shared/src/import.ts` ergänzen, JSON Schema und Fixture neu erzeugen (siehe `packages/contract-tests/fixtures/exports/README.md`); bestehende Fixtures nie ändern.
- Lokales Schema ändern: neue `this.version(n + 1)` in `apps/web/src/local/db.ts` mit Upgrade; bestehende Versionen nie ändern (T-MIG-02).
- Neue Abhängigkeiten des Servers: Composer-Pakete ohne C-Erweiterungen (Webhosting); das Image (`php:8.3-fpm`) muss auf `linux/arm64` bauen, der arm64-Build im Gitea-Nightly (`msz/gitea-workflows`, 22:00) prüft das.
- Editor: Neue strukturelle Schritte in `PageEditor.vue` rufen vorher `checkpoint()` auf, sonst fehlen sie im blockübergreifenden Undo (ADR 0008). Kinder eines Toggles sind die folgenden Blöcke mit größerem `attrs.indent` ([ADR 0019](docs/adr/0019-block-types.md)).
- Oberfläche: Farben, Abstände, Schriftgrößen, Radien und Schatten nur über die Tokens in `apps/web/src/styles.css` (`docs/product/ux-guide.md`).
- Service Worker: `apps/web/src/sw/service-worker.ts`, gebaut von `apps/web/service-worker.plugin.ts` (Precache-Liste, Version) – nur im Production-Build. PWA-E2E (`e2e/pwa-*.spec.ts`) laufen im Playwright-Projekt `pwa` gegen `vite preview`. Komponenten mit entprellten Eingaben melden ihren Flush über `registerPendingEdits` an (Update-Neuladen).
- Views werden eager importiert (kein Lazy-Loading), damit Navigation nach Netzverlust funktioniert.
- Eingaben im Server immer mit `Validation::parseInput(schema, …)` validieren; die Schemas in `apps/server-php/src/Shared` sind Ports der zod-Schemas aus `@notion-alt/shared` (gleiche Pfade und Codes).
- Sync-Push: `Apply::batch` (`apps/server-php/src/Sync/Apply.php`) wendet einen Batch in einer Transaktion mit einem Savepoint je Operation an (#95). Prüfungen pro Operation gehören in `applyIn`; ein `reject` verwirft nur den Savepoint dieser Operation.
- Neue synchronisierte Entitätstabelle: in `TABLES` von `apps/server-php/src/Sync/Snapshot.php` aufnehmen (seitenweiser Snapshot, #97) und per Migration einen Index auf `(workspace_id, id)` anlegen.
- Lokaler Suchindex (#98): Neue Schreibpfade im `LocalStore` melden betroffene Seiten mit `mark()`. Sonst bleibt der gespeicherte Index veraltet. Ändern sich die Felder oder Optionen des Index, `SEARCH_INDEX_FORMAT` erhöhen.
- Workspace-Daten immer über Funktionen abfragen, die die User-ID einschränken (`Workspaces::findForUser`).
- Betrieb, Konfiguration: `docs/operations/deployment.md`; Backup, Restore, Upgrade: `docs/operations/backup.md`. Ändern sich die Backup-Befehle, beides anpassen: Doku und `scripts/backup-restore-test.sh`.
