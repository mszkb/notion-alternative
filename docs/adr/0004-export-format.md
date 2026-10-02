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
