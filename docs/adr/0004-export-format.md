# 0004 – Exportformat

- **Status:** Proposed
- **Datum:** 2026-10-02

## Kontext

Prinzip „Export first“: Der vollständige Workspace muss in offenen Formaten exportierbar und in einer frischen Installation wieder importierbar sein.

## Vorschlag

- **Markdown:** menschenlesbar, ein File pro Dokument, Ordnerstruktur = Seitenbaum, Front Matter für Metadaten (ID, Tags, Favorit, Zeitstempel).
- **JSON:** verlustfreie, maschinenlesbare Repräsentation (Dokumente, Blöcke, Tags, Links, Revisionen) mit Schema-Version.
- **ZIP:** Bündel aus Markdown und/oder JSON plus Anhänge und Manifest.

## Offene Fragen

- Darstellung von Backlinks/Seitenlinks in Markdown (Wiki-Links vs. relative Pfade).
- Werden Revisionen/Verlauf mit exportiert?
- Versionierung des JSON-Schemas und Import älterer Exporte.

## Entscheidung

_Offen (Phase 0)._

## Konsequenzen

_Offen._
