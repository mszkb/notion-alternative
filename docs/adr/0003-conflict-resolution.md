# 0003 – Konfliktauflösung

- **Status:** Proposed
- **Datum:** 2026-10-02

## Kontext

Prinzip: Konflikte werden sichtbar und nachvollziehbar behandelt, nicht still überschrieben. Einfaches Last-write-wins ist ausgeschlossen.

## Optionen

1. **Block-Merge + manuelle Konfliktauflösung** – Änderungen an unterschiedlichen Blöcken automatisch zusammenführen; Änderungen am selben Block als Konflikt anzeigen (beide Stände erhalten).
2. **CRDT** (z. B. Yjs/Automerge) – automatische Zusammenführung auch innerhalb eines Blocks; Grundlage für spätere Echtzeit-Kollaboration, aber höhere Komplexität und Exportanforderungen.
3. **Operation-based Sync** (OT-ähnlich) – serverseitige Transformation.

## Vorschlag

MVP mit Option 1; CRDT/operation-based Sync als spätere Option für Phase 8 offenhalten (Datenmodell nicht verbauen).

## Entscheidung

_Offen (Phase 0)._

## Konsequenzen

_Offen._
