# 0012 – Dateianhänge

- **Status:** Accepted
- **Datum:** 2026-10-03

## Kontext

Phase 5 bringt Bilder und Dateien in Seiten (Issue #62). Prinzipien: local-first (Anhänge auch offline anlegen und ansehen), keine stillen Überschreibungen, Export first. [ADR 0006](0006-tech-stack.md) legt Dateien ins Daten-Volume (S3 später). Uploads sind ein typischer Weg für Stored XSS (SVG, HTML).

## Optionen

1. **Inhalt als Teil der Operation** (Base64 im Push). **−** Sprengt Batch-Größen (nginx 1 MB), Log und Pull würden Dateien mitschleppen.
2. **Metadaten als synchronisierte Entität, Inhalt separat per Upload/Download, unveränderlich pro ID.** **+** Sync bleibt klein und idempotent; Inhalt wird per Prüfsumme verifiziert und ist cachebar. **−** Zwei Wege (Metadaten früher da als Inhalt) → Platzhalter „wird hochgeladen“.

## Entscheidung

Option 2.

- **Entität `attachment`:** `id`, `workspace_id`, `document_id`, `name`, `mime_type`, `size`, `sha256`, `created_at`, `revision`, `deleted_at` (+ serverseitig `stored_at`). Operationen: `create` und `delete`; der Inhalt einer ID ändert sich nie (neue Datei = neuer Anhang).
- **Blocktypen** `image` und `file` mit `attrs.attachmentId`; `content` ist die Bildunterschrift bzw. der Anzeigename (Markdown-Inline). Ergänzt [ADR 0008](0008-block-editor.md). Markdown: `![Name](attachment:<id>)` bzw. `[Name](attachment:<id>)`; der Export ([ADR 0004](0004-export-format.md)) schreibt relative Pfade.
- **Offline:** Der Client legt die Datei als Blob in IndexedDB ab und queued die `create`-Operation; nach deren Bestätigung lädt er den Inhalt hoch (`PUT /api/attachments/:id/content`, Größe und SHA-256 müssen passen, idempotent). Andere Geräte laden den Inhalt bei Bedarf (`GET …/content`) und cachen ihn lokal.
- **Sicherheit:** Inline ausgeliefert werden nur Rasterbilder (PNG, JPEG, GIF, WebP, AVIF); alles andere (auch SVG, HTML, PDF) als Download (`Content-Disposition: attachment`, `application/octet-stream`). Immer `X-Content-Type-Options: nosniff` und `Content-Security-Policy: sandbox; default-src 'none'`. Zugriff nur im eigenen Workspace.
- **Grenzen:** Größe pro Datei per `ATTACHMENT_MAX_MB` (Standard 25); Gesamtlimits folgen mit Issue #64.
- **Löschen:** Tombstone wie bei anderen Entitäten; die Datei wird erst nach `ATTACHMENT_RETENTION_DAYS` (Standard 30) physisch entfernt, damit Wiederherstellung (Phase 5) und Konfliktauflösung möglich bleiben.

## Konsequenzen

- Speicherort `DATA_DIR/attachments/<workspace>/<id>` ist Teil des Volume-Backups.
- nginx erlaubt für `/api/attachments/` größere Requests als für die übrige API.
- Lokaler Cache der Inhalte liegt in IndexedDB getrennt von den Metadaten ([Cache-Strategie](../architecture/caching.md)); Eviction und Quoten folgen mit #64.
- Ein S3-Backend (#63) ersetzt nur die Speicherschicht; Protokoll und IDs bleiben.
