# Architekturüberblick

> Status: **Vorschlag**. Verbindliche Entscheidungen werden in [ADRs](../adr/README.md) getroffen.

```
┌──────────────────────────── Gerät ────────────────────────────┐
│  PWA (Nuxt/Vue)                                               │
│   ├─ Editor / UI                                              │
│   ├─ Lokale DB (SQLite-Wrapper oder IndexedDB)  ◄── Wahrheit  │
│   ├─ Offline-Queue (Operationen mit Operation-ID)             │
│   ├─ Lokale Volltextsuche                                     │
│   └─ Service Worker (Cache, Web Push)                         │
└───────────────┬───────────────────────────────▲───────────────┘
                │ Delta-Sync (Cursor, idempotent) │ Web Push: sync_available
┌───────────────▼───────────────────────────────┴───────────────┐
│  Self-hosted Server (Docker Compose)                          │
│   ├─ API (Fastify oder .NET)                                  │
│   ├─ PostgreSQL (Daten, Änderungslog, FTS)                    │
│   ├─ S3-kompatibler Object Storage (Anhänge)                  │
│   └─ VAPID-Keypair / Push-Versand                             │
└───────────────────────────────────────────────────────────────┘
```

## Komponenten

| Bereich | Vorschlag | ADR |
| --- | --- | --- |
| Frontend | Nuxt/Vue als responsive PWA mit Service Worker | [0006](../adr/0006-tech-stack.md) |
| Lokaler Speicher | SQLite über geeigneten Wrapper **oder** IndexedDB mit klarer Persistenzstrategie | [0001](../adr/0001-local-storage.md) |
| Backend | Fastify oder .NET API | [0006](../adr/0006-tech-stack.md) |
| Serverdatenbank | PostgreSQL | – |
| Dateien | S3-kompatibler Object Storage | – |
| Sync | Versioniertes Änderungslog mit Cursor, Geräte-ID, Revisionen, Idempotency Keys | [0002](../adr/0002-sync-protocol.md) |
| Sync (später) | CRDT oder operation-based Sync für echte parallele Bearbeitung | [0003](../adr/0003-conflict-resolution.md) |
| Suche | Zunächst PostgreSQL Full Text Search; später optional Meilisearch/OpenSearch | – |
| Push | Web Push (VAPID), optionaler Hosted Relay | [0005](../adr/0005-push.md) |
| Export | Markdown, JSON, ZIP | [0004](../adr/0004-export-format.md) |
| Deployment | Docker Compose, Healthchecks, Migrationen, dokumentierte Backup-Prozedur | – |

Weiter: [Datenmodell & Sync](sync.md) · [Push-Strategie](push.md)
