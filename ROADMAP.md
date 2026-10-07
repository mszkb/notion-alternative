# Roadmap

Self-hosted Notion-Alternative mit offline-first PWA.

Produktziel, Prinzipien und Scope: [`docs/product/vision.md`](docs/product/vision.md) · Architektur: [`docs/architecture/overview.md`](docs/architecture/overview.md) · Akzeptanzkriterien: [`docs/product/acceptance-criteria.md`](docs/product/acceptance-criteria.md)

## Milestones

| Milestone | Phasen | Ziel |
| --- | --- | --- |
| **Prototype** | 0–2 | Lokaler Editor mit Seitenbaum und lokaler Suche läuft im Browser |
| **Offline MVP** | 3–4 | Mehrgeräte-Sync, Offline-Queue, installierbare PWA mit Web Push |
| **Beta** | 5–6 | Anhänge, Versionen/Wiederherstellung, Export/Import |
| **Stable** | 7 | Gehärtet: Konflikt-/Offline-Tests, Security Review, automatisiertes Backup/Restore |
| **Collaboration** | 8 | Sharing, Kommentare, Berechtigungen, Echtzeit |
| *(Paid services)* | 9 | Optionale kostenpflichtige Dienste |

> Die Zuordnung Phase → Milestone ist ein Vorschlag aus Phase 0 und kann sich noch ändern.

---

## Phase 0 – Discovery

- [x] Zielgruppe schärfen ([`docs/product/vision.md`](docs/product/vision.md): Umsteiger von Notion, [#17](https://github.com/mszkb/notion-alternative/issues/17))
- [x] Datenmodell festlegen ([`docs/architecture/sync.md`](docs/architecture/sync.md))
- [x] Exportformat festlegen – [ADR 0004](docs/adr/0004-export-format.md)
- [x] Lizenz bestätigen (MIT, siehe `LICENSE`)
- [x] Offline-Anforderungen definieren – [ADR 0001](docs/adr/0001-local-storage.md)
- [x] Konfliktstrategie festlegen – [ADR 0003](docs/adr/0003-conflict-resolution.md)
- [x] Sync-Protokoll festlegen – [ADR 0002](docs/adr/0002-sync-protocol.md)
- [x] Push-Strategie bestätigen – [ADR 0005](docs/adr/0005-push.md)
- [x] Tech-Stack entscheiden (Frontend, Backend) – [ADR 0006](docs/adr/0006-tech-stack.md)

## Phase 1 – Foundation

- [x] Monorepo-Struktur
- [x] CI (Lint, Typecheck, Tests)
- [x] Auth (Benutzerkonto)
- [x] Workspace-Modell
- [x] Docker Compose mit 2 Containern (`frontend`, `backend`)
- [x] Referenz-Deployment auf echtem Host (Loopback + SSH-Tunnel), Smoke-Test und T-OFF-01/02 manuell – [ADR 0010](docs/adr/0010-reference-deployment-and-https.md)
- [x] Images auch für `linux/arm64` (CI-Build, Raspberry Pi gemessen)
- [x] Datenbank (SQLite) & Migrationen
- [x] Observability: strukturierte Logs, Healthchecks
- [x] Observability: Metriken
- [x] Login-Rate-Limiting, Passwort ändern

Idee für später: Passwort-Reset durch den Admin per CLI im Backend-Container (kein Mailversand im MVP).

## Phase 2 – Local editor

Entscheidungen: [ADR 0008](docs/adr/0008-block-editor.md) (eigener Block-Editor, Markdown-Inline), [ADR 0009](docs/adr/0009-local-data-layer.md) (Datenschicht, Operationen, MiniSearch).

- [x] Lokale Datenbank (IndexedDB/Dexie, gemäß ADR 0001) inkl. Offline-Queue in derselben Transaktion und `navigator.storage.persist()`
- [x] Editor: Überschriften, Text, Listen, Code, Links, Zitate
- [x] Navigation & verschachtelter Seitenbaum
- [x] Tags, Favoriten, zuletzt bearbeitet
- [x] Backlinks & Seitenverlinkung
- [x] Lokale Volltextsuche
- [x] App startet ohne Server aus lokalen Daten (T-OFF-01, T-OFF-02 automatisiert)

- [x] Blockübergreifendes Undo/Redo und Markieren ganzer Blöcke (Kopieren als Markdown, Löschen) – [ADR 0008](docs/adr/0008-block-editor.md)

„Lokale Daten löschen“ beim Abmelden ist mit Phase 3 umgesetzt, App-Dateien offline cachen mit Phase 4 (Service Worker).

## Phase 3 – Sync

- [x] Geräteverwaltung (Device-ID, Registrierung, Umbenennen/Entfernen)
- [x] Änderungslog mit Revisionen (Server: Entitäten, `changes`, `applyOperation`)
- [x] Delta-Sync mit Cursor (`GET /api/sync/pull`)
- [x] Offline-Queue mit idempotenten Operationen (`POST /api/sync/push`)
- [x] Tombstones für Löschungen (Replikation, Löschen vs. Bearbeiten als Konflikt)
- [x] Vollständiger Re-Sync (`GET /api/sync/snapshot`, `410`, „Neu synchronisieren“)
- [x] Sync-Trigger: Start, Fokuswechsel, Push (Hook), periodisch
- [x] Block-Merge und Konfliktanzeige (gemäß ADR 0003)
- [x] Serverseitige Volltextsuche (SQLite FTS5)

## Phase 4 – PWA

- [x] Web App Manifest (Icons inkl. maskable/Apple, iOS-Meta-Tags)
- [x] Service Worker (eigener, ohne Bibliothek; Update-Hinweis, Push-Handler)
- [x] Installationsflow (inkl. iOS-Hinweise, [Anleitung](docs/user/installation.md); iOS-Test manuell)
- [x] Cache-Strategie ([`caching.md`](docs/architecture/caching.md))
- [x] Web Push (VAPID, Subscription nach Nutzeraktion; ohne Bibliothek, Payload ohne Inhalte)
- [x] HTTPS für Smartphones/weitere Geräte entscheiden ([ADR 0011](docs/adr/0011-https-for-mobile-devices.md): Tailscale im Home-Lab, sonst Webhosting/Reverse Proxy)

## Phase 5 – Files and history

- [x] Dateianhänge (Bild/Datei, offline anlegbar, [ADR 0012](docs/adr/0012-attachments.md))
- [x] S3-kompatiblen Object Storage anbinden (optional, ersetzt Datei-Volume; Migration per Befehl)
- [x] Speicher- und Größenlimits (pro Datei und pro Workspace, Anzeige auf der Kontoseite)
- [x] Versionen / Revisionsverlauf (aus dem Änderungslog, Diff zur aktuellen Version, [ADR 0013](docs/adr/0013-version-history.md))
- [x] Wiederherstellung früherer Versionen (ganze Version oder einzelne Blöcke, Papierkorb)

## Phase 6 – Export/import

- [x] Markdown-Export
- [x] JSON-Export
- [x] ZIP-Export (inkl. Anhänge)
- [x] Import in frische Installation
- [x] Round-Trip-Importtests

## Phase 7 – Hardening

- [x] Konflikttests (Mehrgeräte)
- [x] Offline-Tests
- [x] Security Review
- [x] Backup/Restore automatisiert getestet
- [x] Backup-/Restore-Dokumentation ([`backup.md`](docs/operations/backup.md); auf frischem Host (Raspberry Pi, arm64) durchgespielt)
- [x] Lasttests ([`load-tests.md`](docs/testing/load-tests.md); offen: Messung auf dem Raspberry Pi)
- [x] Re-Sync großer Workspaces seitenweise mit Fortschritt ([#97](https://github.com/mszkb/notion-alternative/issues/97))
- [x] Lokaler Suchindex in IndexedDB gespeichert ([#98](https://github.com/mszkb/notion-alternative/issues/98))
- [x] App bei 10 000 Seiten im Ziel: Kaltstart, Öffnen, Tippen ([#102](https://github.com/mszkb/notion-alternative/issues/102))
- [x] Entferntes Gerät synchronisiert nach erneuter Anmeldung als neues Gerät weiter ([#46](https://github.com/mszkb/notion-alternative/issues/46))
- [ ] Seiteninhalte bei Bedarf laden, „Alles offline verfügbar machen“ in den Einstellungen ([ADR 0017](docs/adr/0017-content-on-demand.md), Proposed, [#112](https://github.com/mszkb/notion-alternative/issues/112))

## Ohne Phase – Opt-in-Telemetrie

Einordnung in eine Phase noch offen ([#103](https://github.com/mszkb/notion-alternative/issues/103)). Gebaut wird erst, wenn [ADR 0016](docs/adr/0016-opt-in-telemetry.md) angenommen ist.

- [ ] ADR: Datenumfang, Empfänger, Einwilligung, Anonymisierung (Vorschlag liegt vor, Entscheidung vertagt; Empfehlungen im ADR)
- [x] Datenkatalog und Datenschutzhinweis ([`docs/privacy/telemetry.md`](docs/privacy/telemetry.md), abgenommen; gilt nach Annahme des ADR)
- [ ] Server: Opt-in des Betreibers, Aggregation, Versand, Vorschau
- [ ] Client: Einwilligung pro Nutzer und lokale Zähler
- [ ] Empfangsdienst (Collector)
- [ ] Tests T-TEL-01…07

## Phase 8 – Collaboration

- [ ] Sharing
- [ ] Kommentare
- [ ] Berechtigungen
- [ ] Echtzeitfunktionen (ggf. CRDT / operation-based Sync)

## Phase 9 – Paid services

- [ ] Hosted Sync
- [ ] Hosted Push Relay
- [ ] Managed Backups
- [ ] Hosting
- [ ] Team-Governance
