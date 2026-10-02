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

- [ ] Zielgruppe schärfen ([`docs/product/vision.md`](docs/product/vision.md))
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
- [x] Datenbank (SQLite) & Migrationen
- [x] Observability: strukturierte Logs, Healthchecks
- [ ] Observability: Metriken
- [ ] Login-Rate-Limiting, Passwort ändern

## Phase 2 – Local editor

Entscheidungen: [ADR 0008](docs/adr/0008-block-editor.md) (eigener Block-Editor, Markdown-Inline), [ADR 0009](docs/adr/0009-local-data-layer.md) (Datenschicht, Operationen, MiniSearch).

- [x] Lokale Datenbank (IndexedDB/Dexie, gemäß ADR 0001) inkl. Offline-Queue in derselben Transaktion und `navigator.storage.persist()`
- [x] Editor: Überschriften, Text, Listen, Code, Links, Zitate
- [x] Navigation & verschachtelter Seitenbaum
- [x] Tags, Favoriten, zuletzt bearbeitet
- [x] Backlinks & Seitenverlinkung
- [x] Lokale Volltextsuche
- [x] App startet ohne Server aus lokalen Daten (T-OFF-01, T-OFF-02 automatisiert)

Offen bzw. später: blockübergreifendes Undo und Markieren über Blockgrenzen ([ADR 0008](docs/adr/0008-block-editor.md)); „Lokale Daten löschen“ beim Abmelden (Phase 3, Geräteverwaltung); App-Dateien offline cachen (Phase 4, Service Worker).

## Phase 3 – Sync

- [ ] Geräteverwaltung (Device-ID, Registrierung)
- [ ] Änderungslog mit Revisionen
- [ ] Delta-Sync mit Cursor
- [ ] Offline-Queue mit idempotenten Operationen
- [ ] Tombstones für Löschungen
- [ ] Vollständiger Re-Sync
- [ ] Sync-Trigger: Start, Fokuswechsel, Push, periodisch
- [ ] Konfliktanzeige (gemäß ADR 0003)
- [ ] Serverseitige Volltextsuche (SQLite FTS5)

## Phase 4 – PWA

- [ ] Web App Manifest
- [ ] Service Worker
- [ ] Installationsflow (inkl. iOS-Hinweise)
- [ ] Cache-Strategie
- [ ] Web Push (VAPID, Subscription nach Nutzeraktion)

## Phase 5 – Files and history

- [ ] Dateianhänge
- [ ] S3-kompatiblen Object Storage anbinden (optional, ersetzt Datei-Volume)
- [ ] Speicher- und Größenlimits
- [ ] Versionen / Revisionsverlauf
- [ ] Wiederherstellung früherer Versionen

## Phase 6 – Export/import

- [ ] Markdown-Export
- [ ] JSON-Export
- [ ] ZIP-Export (inkl. Anhänge)
- [ ] Import in frische Installation
- [ ] Round-Trip-Importtests

## Phase 7 – Hardening

- [ ] Konflikttests (Mehrgeräte)
- [ ] Offline-Tests
- [ ] Security Review
- [ ] Backup/Restore automatisiert getestet
- [ ] Backup-/Restore-Dokumentation
- [ ] Lasttests

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
