# 0006 – Tech-Stack (Frontend/Backend)

- **Status:** Accepted, Server-Teil superseded by 0018
- **Datum:** 2026-10-02


> **Teilweise ersetzt:** Der Teil „Backend (Fastify, Node)“ ist durch [ADR 0018](0018-php-backend.md) (PHP-Backend, angenommen 2026-10-08) ersetzt. Bis zur Umstellung ([#129](https://github.com/mszkb/notion-alternative/issues/129)) läuft weiter der Node-Server.

## Kontext

Die Roadmap schlug einen Stack vor, legte ihn aber nicht fest. Für den Prototyp (Phasen 0–2) soll der Betrieb möglichst einfach sein: wenige Container, keine zusätzlichen Infrastrukturdienste.

## Optionen

- **Frontend:** Nuxt/Vue als PWA **oder** Vue 3 als reine SPA (Vite).
- **Backend:** Fastify (TypeScript, gemeinsame Typen mit dem Frontend im Monorepo) **oder** .NET API.
- **Server-DB:** PostgreSQL **oder** SQLite.
- **Dateien:** S3-kompatibler Object Storage **oder** lokales Dateisystem (Volume).
- **Suche:** PostgreSQL FTS bzw. SQLite FTS5, später optional Meilisearch/OpenSearch.
- **Deployment:** Docker Compose.

## Entscheidung

| Bereich | Entscheidung |
| --- | --- |
| Sprache | **TypeScript** durchgehend (Frontend, Backend, geteilte Pakete) |
| Frontend | **Vue 3 als SPA** mit Vite – **ohne Nuxt**. Die App ist eine reine Client-Anwendung; SSR bringt für eine local-first PWA keinen Nutzen. PWA-Funktionen (Manifest, Service Worker) kommen in Phase 4. |
| Backend | **Fastify** (TypeScript) |
| Server-DB | **SQLite** für den Prototyp (eine Datei im Volume des Backend-Containers) |
| Serverseitige Suche | **SQLite FTS5** |
| Dateien | Vorerst lokales Volume des Backend-Containers; **S3-kompatibler Storage später** (frühestens Phase 5) |
| Monorepo | Gemeinsame Pakete für Datenmodell, Schemas und Sync-Logik, die Client und Server nutzen |
| Deployment | Docker Compose mit **genau zwei Containern**: |
| | • `backend` – Fastify-API inkl. SQLite-Datei und Datei-Volume |
| | • `frontend` – statischer Webserver für die gebaute SPA, leitet `/api` an `backend` weiter (gleicher Origin) |

Begründung:

- Gemeinsamer TypeScript-Code für Sync, Schemas und Konfliktlogik verhindert, dass dieselbe Logik in zwei Sprachen auseinanderläuft.
- SQLite und lokales Volume halten den Betrieb beim Prototyp minimal (kein separater DB- oder Storage-Container) und machen Backups zu einer Dateikopie.
- Gleicher Origin für SPA und API vereinfacht Cookies/Auth, CORS und den Service Worker.

## Konsequenzen

- Der Datenzugriff im Backend wird hinter einer schmalen Repository-Schicht gekapselt, damit ein späterer Wechsel auf PostgreSQL möglich bleibt. Ob und wann gewechselt wird, entscheidet ein eigenes ADR (spätestens vor Milestone **Stable**).
- SQLite verträgt nur einen Schreiber gleichzeitig – für Einzelanwender und kleine Teams ausreichend; mit WAL-Modus betreiben.
- Anhänge liegen bis zur S3-Anbindung im Volume des Backends; Backup = SQLite-Backup + Datei-Volume.
- Die Konkretisierung von Bibliotheken (SQLite-Treiber, Query-Builder/Migrationen, Webserver im `frontend`-Container, Editor-Bibliothek) erfolgt in Phase 1 bzw. 2.
- `ROADMAP.md` und [Architekturüberblick](../architecture/overview.md) sind entsprechend angepasst (PostgreSQL/S3 aus Phase 1 entfernt).
