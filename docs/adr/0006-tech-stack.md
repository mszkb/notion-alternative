# 0006 – Tech-Stack (Frontend/Backend)

- **Status:** Proposed
- **Datum:** 2026-10-02

## Kontext

Die Roadmap schlägt einen Stack vor, legt ihn aber nicht fest.

## Optionen

- **Frontend:** Nuxt/Vue als responsive PWA mit Service Worker.
- **Backend:** Fastify (TypeScript, gemeinsame Typen mit dem Frontend im Monorepo) **oder** .NET API.
- **Server-DB:** PostgreSQL; **Dateien:** S3-kompatibler Object Storage.
- **Suche:** PostgreSQL FTS, später optional Meilisearch/OpenSearch.
- **Deployment:** Docker Compose.

## Offene Fragen

- Fastify vs. .NET: geteilter Code (Sync-Logik, Schemas) zwischen Client und Server spricht für TypeScript.

## Entscheidung

_Offen (Phase 0)._

## Konsequenzen

_Offen._
