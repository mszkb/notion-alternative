# 0002 – Sync-Protokoll

- **Status:** Proposed
- **Datum:** 2026-10-02

## Kontext

Mehrgeräte-Sync muss offline-fähig, idempotent und verlustfrei sein. Siehe [Datenmodell & Sync](../architecture/sync.md).

## Vorschlag

Versioniertes Änderungslog auf dem Server mit:

- Cursor pro Gerät (`SyncCursor`)
- Geräte-ID
- Revisionen pro Dokument/Block
- Idempotency Keys (Operation-ID je lokaler Änderung)
- Tombstones für Löschungen
- Fallback: vollständiger Re-Sync, wenn der Log ab Cursor nicht mehr verfügbar ist

## Offene Fragen

- Granularität der Operationen (Dokument vs. Block vs. Feld).
- Log-Kompaktierung und Aufbewahrungsdauer von Tombstones.
- Transport (REST-Batch vs. WebSocket) und Batching-Größen.

## Entscheidung

_Offen (Phase 0)._

## Konsequenzen

_Offen._
