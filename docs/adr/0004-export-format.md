# 0004 – Exportformat

- **Status:** Accepted
- **Datum:** 2026-10-02

## Kontext

Prinzip „Export first“: Der vollständige Workspace muss in offenen Formaten exportierbar und in einer frischen Installation wieder importierbar sein.

## Optionen

- **Seitenlinks in Markdown:** relative Pfade **oder** Wiki-Links (`[[Titel]]`).
- **Verlauf:** mit exportieren **oder** nur aktueller Stand.

## Entscheidung

- **Markdown:** menschenlesbar, eine Datei pro Dokument, Ordnerstruktur = Seitenbaum. Front Matter mit `id`, `title`, `tags`, `favorite`, `created_at`, `updated_at`.
  - Seitenlinks als **relative Pfade** (`[Titel](../ordner/seite.md)`), damit sie in jedem Markdown-Viewer klickbar sind. Die stabile `id` im Front Matter erlaubt beim Import eine eindeutige Zuordnung, auch wenn Dateien umbenannt wurden.
  - Markdown enthält **nur den aktuellen Stand**.
- **JSON:** verlustfreie, maschinenlesbare Repräsentation (Dokumente, Blöcke, Tags, Links, Anhang-Metadaten) **inklusive Revisionsverlauf**. Top-Level-Feld `schema_version` (Ganzzahl).
- **ZIP:** Bündel aus Markdown **und** JSON plus Anhänge und `manifest.json` (Exportzeitpunkt, `schema_version`, Prüfsummen der Dateien).
- **Import:** primär aus JSON bzw. ZIP (verlustfrei). Ältere `schema_version`s werden beim Import schrittweise migriert; der Import unterstützt alle bisher veröffentlichten Versionen.

## Konsequenzen

- Exporte mit Verlauf können groß werden; der Export bietet deshalb eine Option „ohne Verlauf“.
- Dateinamen werden aus Titeln abgeleitet und bei Kollisionen eindeutig gemacht; Links müssen danach aufgelöst werden.
- Jede Änderung am Datenmodell erfordert eine neue `schema_version` und eine Import-Migration.
- Testfälle: T-EXP-01, T-EXP-02 (Round-Trip).

## Umsetzung (Phase 6)

- Exporte entstehen clientseitig aus der lokalen Datenbank (offline möglich); Verlauf und auf dem Gerät fehlende Anhänge holt der Client vom Server, wenn er erreichbar ist (`GET /api/sync/log`, Anhang-Download).
- ZIP-Aufbau: `manifest.json`, `workspace.json` (JSON-Export), `markdown/` (Markdown-Export, Anhänge in `markdown/_attachments/`). Das Manifest enthält zusätzlich `format`, die Zuordnung Anhang-ID → Pfad und `missing_attachments` für Anhänge, deren Inhalt beim Export nicht verfügbar war.
- ZIP ohne Bibliothek: eigener Writer/Reader in `packages/shared/src/zip.ts` (Einträge unkomprimiert, UTF-8-Namen, kein ZIP64, also bis 4 GB). Komprimierung lohnt bei Text kaum gegen den Aufwand, Bilder sind bereits komprimiert. Damit keine neue Abhängigkeit nach ADR 0007.
- JSON-Schema: zod `jsonExportSchema` in `packages/shared`, generiert nach `docs/architecture/export.schema.json`.
- Import (`POST /api/import`): Der Client prüft Archiv (Pfade, Größen, Prüfsummen, Anhang-Hashes) und Schema und migriert ältere Versionen (`migrateExport`, eine Migration pro Versionsschritt). Der Server legt in einer Transaktion einen **neuen** Workspace an (Entitäten mit ihren IDs und Revisionen, Verlauf als Änderungslog mit neuen `seq`, Suchindex). Existiert eine ID schon, antwortet er `409 ids_exist` ohne Änderung; der Client bietet dann den Import als Kopie mit neuen IDs an (`remapExportIds`, inkl. Links und Verlauf). Das Log gilt bis zum importierten Verlauf als kompaktiert (`compacted_seq`), damit Geräte mit einem Snapshot starten statt einen evtl. lückenhaften Verlauf abzuspielen. Anhang-Inhalte lädt der Client über den normalen Upload nach.
- Bösartige Archive: Der ZIP-Reader akzeptiert nur unkomprimierte Einträge (keine Zip-Bomben), lehnt unsichere Pfade (`..`, absolute Pfade, Backslashes), Duplikate und Einträge außerhalb des Archivs ab und prüft jede CRC. Der Server prüft Referenzen innerhalb des Exports, Speicherlimit und Body-Größe (`IMPORT_MAX_MB`).
