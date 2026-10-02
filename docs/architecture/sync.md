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

## Felder (MVP)

Alle IDs sind UUIDs und werden vom Client erzeugt (offline-fähig). Synchronisierte Entitäten tragen zusätzlich `revision` (vom Server vergeben, steigt pro Änderung) und `deleted_at` (Tombstone, `null` = aktiv).

| Entität | Felder |
| --- | --- |
| `Workspace` | `id`, `name`, `owner_id`, `created_at` |
| `User` | `id`, `email`, `password_hash`, `created_at` |
| `Device` | `id`, `user_id`, `name`, `created_at`, `last_seen_at` |
| `Document` | `id`, `workspace_id`, `parent_id` (Seitenbaum, `null` = Wurzel), `title`, `sort_key`, `favorite`, `created_at`, `updated_at`, `revision`, `deleted_at` |
| `Block` | `id`, `document_id`, `type` (`paragraph`, `heading`, `list_item`, `code`, `quote`, …), `content` (Text inkl. Inline-Formatierung und Seitenlinks), `attrs` (z. B. Überschriftenebene, Code-Sprache), `sort_key`, `revision`, `deleted_at` |
| `Tag` | `id`, `workspace_id`, `name`, `revision`, `deleted_at`; Zuordnung über `document_tags` |
| `Change` | `seq` (monoton pro Workspace = Cursor), `op_id`, `device_id`, `entity`, `entity_id`, `kind`, `revision`, `payload`, `applied_at` |
| `Conflict` | `id`, `entity`, `entity_id`, `base_revision`, `local` (Stand des Geräts), `remote` (Stand des Servers), `created_at`, `resolved_at` |
| `SyncCursor` | lokal auf dem Gerät: `workspace_id`, `cursor` (letzte gesehene `seq`) |
| `Attachment`, `Revision` | werden in Phase 5 konkretisiert |

- `sort_key`: fraktionaler Index (String), damit Einfügen und Verschieben auf mehreren Geräten ohne Umnummerierung funktioniert.
- Backlinks werden aus Seitenlinks in `Block.content` abgeleitet, nicht separat synchronisiert.
- Die Inline-Repräsentation von `content` wird mit der Editor-Wahl in Phase 2 festgelegt.

Protokoll und Operationen: [ADR 0002](../adr/0002-sync-protocol.md).

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
