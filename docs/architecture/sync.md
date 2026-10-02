# Datenmodell & Sync

## Entitäten

| Entität | Zweck |
| --- | --- |
| `Workspace` | Container für Dokumente eines Nutzers / Teams |
| `User` | Benutzerkonto |
| `Device` | Registriertes Gerät mit stabiler Geräte-ID |
| `Document` | Seite/Dokument, verschachtelbar (Seitenbaum) |
| `Block` | Inhaltseinheit eines Dokuments (Granularität für Merge) |
| `Attachment` | Datei im Object Storage, mit Größenlimit |
| `Revision` | Versionsstand eines Dokuments/Blocks (Verlauf, Wiederherstellung) |
| `Change` | Eintrag im Änderungslog (Operation) |
| `Tag` | Schlagwort; Favoriten/zuletzt bearbeitet als Metadaten |
| `SyncCursor` | Position eines Geräts im Änderungslog |

> Das genaue Schema ist Teil von Phase 0 und wird in [ADR 0002](../adr/0002-sync-protocol.md) konkretisiert.

## Regeln

1. **Operation-ID:** Jede lokale Änderung erhält eine eindeutige Operation-ID und wird **idempotent** zum Server übertragen (Wiederholungen ändern nichts).
2. **Kein verstecktes Last-write-wins.** Änderungen werden nie still überschrieben.
3. **Konflikte** werden entweder automatisch auf **Blockebene** zusammengeführt oder als verständlicher Konflikt zur manuellen Entscheidung angezeigt ([ADR 0003](../adr/0003-conflict-resolution.md)).
4. **Sync-Trigger:** Delta-Sync beim App-Start, beim Fokuswechsel, nach Push und periodisch.
5. **Re-Sync:** Ist der Änderungslog ab dem Cursor nicht mehr verfügbar (z. B. kompaktiert), muss ein vollständiger Re-Sync möglich sein.
6. **Tombstones:** Löschungen werden als Tombstones geführt, damit sie auf anderen Geräten korrekt repliziert werden.

## Ablauf (Skizze)

```
Lokale Bearbeitung
  └─► lokale DB schreiben + Operation (op_id, device_id, base_revision) in Offline-Queue

Sync-Lauf (Start | Fokus | Push | Timer)
  1. Push: Queue an Server senden (idempotent per op_id)
  2. Server prüft base_revision
       ├─ passt         → anwenden, neue Revision, Change ins Log
       ├─ Block-Merge   → automatisch zusammenführen
       └─ echter Konflikt → Konflikt-Objekt anlegen, beide Stände erhalten
  3. Pull: Changes ab SyncCursor laden, lokal anwenden, Cursor fortschreiben
  4. Cursor ungültig → vollständiger Re-Sync
```

## Später

CRDT oder operation-based Sync für echte parallele Bearbeitung und Echtzeit-Kollaboration (Phase 8).
