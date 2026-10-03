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
| `Device` | `id`, `user_id`, `name`, `created_at`, `last_seen_at`, `revoked_at` (entfernt; Zeile bleibt, damit Sessions und Operationen des Geräts dauerhaft abgelehnt werden) |
| `Document` | `id`, `workspace_id`, `parent_id` (Seitenbaum, `null` = Wurzel), `title`, `sort_key`, `favorite`, `created_at`, `updated_at`, `revision`, `deleted_at` |
| `Block` | `id`, `document_id`, `type` (`paragraph`, `heading`, `list_item`, `code`, `quote`, …), `content` (Text inkl. Inline-Formatierung und Seitenlinks), `attrs` (z. B. Überschriftenebene, Code-Sprache), `sort_key`, `revision`, `deleted_at` |
| `Tag` | `id`, `workspace_id`, `name`, `revision`, `deleted_at` |
| `DocumentTag` | `id`, `workspace_id`, `document_id`, `tag_id`, `revision`, `deleted_at` – Zuordnung Tag ↔ Dokument, eigene Entität `document_tag` ([ADR 0009](../adr/0009-local-data-layer.md)) |
| `Change` | `seq` (monoton pro Workspace = Cursor), `op_id`, `device_id`, `entity`, `entity_id`, `kind`, `revision`, `payload`, `applied_at` |
| `Conflict` | `id`, `entity`, `entity_id`, `base_revision`, `local` (Stand des Geräts), `remote` (Stand des Servers), `created_at`, `resolved_at` |
| `SyncCursor` | lokal auf dem Gerät: `workspace_id`, `cursor` (letzte gesehene `seq`) |
| `Attachment`, `Revision` | werden in Phase 5 konkretisiert |

- `sort_key`: fraktionaler Index (String), damit Einfügen und Verschieben auf mehreren Geräten ohne Umnummerierung funktioniert.
- Backlinks werden aus Seitenlinks in `Block.content` abgeleitet, nicht separat synchronisiert.
- `content` ist ein Markdown-Inline-String; Seitenlinks als `[Titel](page:<uuid>)`, Blocktypen und `attrs` siehe [ADR 0008](../adr/0008-block-editor.md).
- Im Code (TypeScript, JSON) heißen die Felder in camelCase (`parentId`, `sortKey`, `deletedAt`, `opId` …), siehe [ADR 0009](../adr/0009-local-data-layer.md).

Protokoll und Operationen: [ADR 0002](../adr/0002-sync-protocol.md).

### Geräte

- Die Geräte-ID entsteht beim ersten Öffnen der lokalen Datenbank eines Benutzers (`meta.deviceId`, eine Dexie-DB pro Benutzer, ADR 0009) und ist damit stabil pro Browserprofil und Konto. Jede Operation trägt sie, auch wenn das Gerät offline gestartet und noch nicht registriert ist.
- Registrierung `POST /api/devices` (`id`, `name`) ist idempotent und läuft bei jedem Online-Refresh. Sie verknüpft die aktuelle Session mit dem Gerät (`sessions.device_id`) und aktualisiert `last_seen_at`; ein vom Nutzer vergebener Name bleibt erhalten. Gehört die ID einem anderen Konto: `409 device_conflict`.
- `GET /api/devices` listet aktive Geräte, `PATCH /api/devices/:id` benennt um, `DELETE /api/devices/:id` entfernt: `revoked_at` wird gesetzt und alle Sessions des Geräts enden. Erneute Registrierung derselben ID antwortet `403 device_revoked`; der Client zeigt das an, lokale Daten bleiben lesbar und bearbeitbar. Das aktuell benutzte Gerät kann sich nicht selbst entfernen (`409 current_device`, stattdessen abmelden).
- Sync (Phase 3) lehnt Operationen ab, deren `device_id` kein aktives Gerät des Benutzers ist (`findActiveDevice`), und aktualisiert `last_seen_at` bei jedem Lauf.

### Änderungslog (Server)

Umsetzung: `apps/server/src/sync/` (Migration `0003_sync`). Payload-Schemas je Entität und Art liegen in `packages/shared/src/operations.ts` und gelten für Client und Server; ein Client-Test prüft, dass alle Operationen des `LocalStore` sie erfüllen.

`applyOperation` wendet **eine** Operation in **einer** SQLite-Transaktion an: Entität schreiben und `changes`-Eintrag anlegen, oder nichts davon. Prüfreihenfolge und Ergebnisse:

1. Workspace gehört dem Benutzer, sonst `rejected: workspace_not_found`.
2. `device_id` ist ein aktives Gerät des Benutzers, sonst `rejected: device_not_active`.
3. `op_id` schon angewendet → `duplicate` mit ursprünglicher Revision und `seq` (Idempotenz). Dieselbe `op_id` für eine andere Entität → `rejected: op_id_reused`.
4. Payload passt zum Schema (`rejected: invalid_payload`), Referenzen (`documentId`, `parentId`, `tagId`) liegen im selben Workspace (`rejected: not_found`), kein Zyklus im Seitenbaum.
5. `create`: Entität darf nicht existieren (`already_exists`), Revision 1. Sonst: Entität muss existieren und aktiv sein (`not_found`, `deleted`). Hat **ein anderes Gerät** die Entität nach `base_revision` geändert, ist das Ergebnis `conflict` mit `currentRevision` – **nichts wird geschrieben** (kein stilles Überschreiben). Block-Merge und Konfliktobjekte ([ADR 0003](../adr/0003-conflict-resolution.md)) setzen auf diesem Ergebnis auf. Änderungen desselben Geräts zählen nicht: Seine Queue baut aufeinander auf (z. B. `create`, danach `update` mit noch `null` als Basis), weil das Gerät die Revision erst nach dem Push erfährt. Eine `base_revision` über der aktuellen ist ungültig.
6. Neue Revision = alte + 1; `seq` = höchste `seq` des Workspaces + 1 (lückenlos, da Schreibtransaktionen in SQLite serialisiert sind).

### Push

`POST /api/sync/push` nimmt bis zu 500 Operationen in Erzeugungsreihenfolge und wendet jede einzeln an (je eine Transaktion); die Antwort enthält pro `opId` `applied`/`duplicate` (mit `revision`, `seq`), `conflict` (mit `currentRevision`) oder `rejected` (mit `code`). `merged` und Konflikt-IDs folgen mit dem Konflikt-Issue. Der Client (`apps/web/src/sync/`) sendet die Queue in Batches (max. 500 Operationen und ≈ 900 KB wegen des nginx-Limits von 1 MB), entfernt bestätigte Operationen und speichert die Server-Revision an der Entität – beides in einer Dexie-Transaktion. Konflikte und Ablehnungen bleiben mit Grund (`issue`) in der Queue und werden in der Seitenleiste angezeigt; nichts geht verloren. Bei Netz- oder Serverfehlern wiederholt der Client mit exponentiellem Backoff (1 s … 5 min). Ausgelöst wird der Push nach lokalen Änderungen (entprellt), beim Start, bei Fokus, bei `online` und minütlich.

### Pull

`GET /api/sync/pull?workspaceId=…&cursor=…&limit=…` (max. 1000) liefert die Changes nach dem Cursor in `seq`-Reihenfolge, den neuen Cursor und `hasMore`. Der Client (`pullWorkspace`) holt nach jedem Push für jeden Workspace Seite um Seite und wendet sie mit `LocalStore.applyRemoteChanges` an. Eine Seite und ihr Cursor (`meta.syncCursor:<workspaceId>`) werden in **einer** Dexie-Transaktion gespeichert; ein Abbruch wiederholt höchstens diese Seite. Regeln beim Anwenden:

- Es entstehen **keine** neuen Queue-Einträge.
- Eigene Changes (gleiche `op_id` in der Queue oder eigene `device_id`) bestätigen nur: Der Queue-Eintrag wird entfernt (falls die Push-Antwort verloren ging) und die Revision gespeichert.
- Hat die Entität noch ungesyncte lokale Operationen, bleibt sie unverändert. Ihr Push trifft dann auf den Konfliktpfad, statt still überschrieben zu werden.
- `delete` setzt `deletedAt` (Tombstone), wie lokal auch für den Teilbaum, Tag-Zuordnungen und Blöcke. Links (Backlinks) werden nachgeführt, und die Suche indiziert betroffene Dokumente über `onChange` neu.
- Der Editor übernimmt entfernte Änderungen auch in einem fokussierten Block, solange dort keine ungespeicherte Eingabe läuft; die Cursorposition bleibt erhalten.

Entitäten anderer Workspaces werden wie fehlende behandelt (keine Offenlegung). Abgelehnte Operationen hinterlassen keinen Eintrag im Log. `listChangesSince` liefert Changes ab einem Cursor, nur für Workspaces des Benutzers. DB-Zeilen werden ausschließlich in `sync/mapping.ts` in camelCase-Objekte übersetzt.

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
