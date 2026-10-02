# Architekturüberblick

> Status: **entschieden** (ADR 0001–0009 akzeptiert). Verbindliche Entscheidungen werden in [ADRs](../adr/README.md) getroffen.

```
┌──────────────────────────── Gerät ────────────────────────────┐
│  SPA / PWA (Vue 3 + Vite)                                     │
│   ├─ Editor / UI                                              │
│   ├─ Lokale DB (IndexedDB via Dexie)            ◄── Wahrheit  │
│   ├─ Offline-Queue (Operationen mit Operation-ID)             │
│   ├─ Lokale Volltextsuche                                     │
│   └─ Service Worker (Cache, Web Push)                         │
└───────────────┬───────────────────────────────▲───────────────┘
                │ Delta-Sync (Cursor, idempotent) │ Web Push: sync_available
┌───────────────▼───────────────────────────────┴───────────────┐
│  Self-hosted Server (Docker Compose, 2 Container)             │
│   ├─ frontend: statischer Webserver (SPA), /api → backend     │
│   └─ backend:  Fastify-API                                    │
│                 ├─ SQLite (Daten, Änderungslog, FTS5)         │
│                 ├─ Datei-Volume (Anhänge; S3 später)          │
│                 └─ VAPID-Keypair / Push-Versand               │
└───────────────────────────────────────────────────────────────┘
```

## Komponenten

| Bereich | Vorschlag | ADR |
| --- | --- | --- |
| Frontend | Vue 3 als SPA (Vite), ohne Nuxt; PWA-Funktionen ab Phase 4 | [0006](../adr/0006-tech-stack.md) |
| Lokaler Speicher | IndexedDB über Dexie, `navigator.storage.persist()` | [0001](../adr/0001-local-storage.md) |
| Backend | Fastify (TypeScript), geteilte Typen/Sync-Logik im Monorepo | [0006](../adr/0006-tech-stack.md) |
| Serverdatenbank | SQLite (Prototyp); Wechsel auf PostgreSQL per eigenem ADR offen | [0006](../adr/0006-tech-stack.md) |
| Dateien | Datei-Volume im Backend; S3-kompatibler Storage später | [0006](../adr/0006-tech-stack.md) |
| Sync | Versioniertes Änderungslog mit Cursor, Geräte-ID, Revisionen, Idempotency Keys | [0002](../adr/0002-sync-protocol.md) |
| Konflikte | Block-Merge + sichtbare Konfliktanzeige; CRDT/operation-based Sync später (Phase 8) | [0003](../adr/0003-conflict-resolution.md) |
| Suche | Server: SQLite FTS5; lokal: MiniSearch; später optional Meilisearch/OpenSearch | [0006](../adr/0006-tech-stack.md), [0009](../adr/0009-local-data-layer.md) |
| Editor | Eigener Block-Editor, `Block.content` als Markdown-Inline | [0008](../adr/0008-block-editor.md) |
| Push | Web Push (VAPID), optionaler Hosted Relay | [0005](../adr/0005-push.md) |
| Export | Markdown, JSON, ZIP | [0004](../adr/0004-export-format.md) |
| Deployment | Docker Compose mit 2 Containern (`frontend`, `backend`), Healthchecks, Migrationen, dokumentierte Backup-Prozedur | [0006](../adr/0006-tech-stack.md) |

Weiter: [Datenmodell & Sync](sync.md) · [Push-Strategie](push.md)
