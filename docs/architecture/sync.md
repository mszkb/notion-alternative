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
| `Conflict` | `id`, `workspace_id`, `op_id`, `entity`, `entity_id`, `document_id`, `reason`, `base_revision`, `local` (nicht angewendete Operation des Geräts), `remote` (Stand des Servers), `created_at`, `resolved_at`, `resolution`, `revision` – Regeln und Auflösung in [ADR 0003](../adr/0003-conflict-resolution.md) |
| `SyncCursor` | lokal auf dem Gerät: `workspace_id`, `cursor` (letzte gesehene `seq`) |
| `Attachment` | `id`, `workspace_id`, `document_id`, `name`, `mime_type`, `size`, `sha256`, `created_at`, `revision`, `deleted_at` (+ Server: `stored_at`) – Inhalt separat, siehe [ADR 0012](../adr/0012-attachments.md) |
| `Revision` | keine eigene Tabelle: Versionen werden aus dem Änderungslog abgeleitet ([ADR 0013](../adr/0013-version-history.md)) |

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
5. `create`: Entität darf nicht existieren (`already_exists`), Revision 1. Sonst: Entität muss existieren und aktiv sein (`not_found`, `deleted`). Hat **ein anderes Gerät** die Entität nach `base_revision` geändert, werden disjunkte Felder zusammengeführt (`merged`); bei gleichem Feld entsteht ein Konfliktobjekt mit beiden Ständen (`conflict` mit `conflictId`), die Entität bleibt unverändert – kein stilles Überschreiben ([ADR 0003](../adr/0003-conflict-resolution.md), Nachtrag). Änderungen desselben Geräts zählen nicht: Seine Queue baut aufeinander auf (z. B. `create`, danach `update` mit noch `null` als Basis), weil das Gerät die Revision erst nach dem Push erfährt. Eine `base_revision` über der aktuellen ist ungültig.
6. Neue Revision = alte + 1; `seq` = höchste `seq` des Workspaces + 1 (lückenlos, da Schreibtransaktionen in SQLite serialisiert sind).

### Push

`POST /api/sync/push` nimmt bis zu 500 Operationen in Erzeugungsreihenfolge und wendet jede einzeln an (je eine Transaktion); die Antwort enthält pro `opId` `applied`/`duplicate` (mit `revision`, `seq`), `conflict` (mit `currentRevision`) oder `rejected` (mit `code`). `merged` und Konflikt-IDs folgen mit dem Konflikt-Issue. Der Client (`apps/web/src/sync/`) sendet die Queue in Batches (max. 500 Operationen und ≈ 900 KB wegen des nginx-Limits von 1 MB), entfernt bestätigte Operationen und speichert die Server-Revision an der Entität – beides in einer Dexie-Transaktion. Konflikte und Ablehnungen bleiben mit Grund (`issue`) in der Queue und werden in der Seitenleiste angezeigt; nichts geht verloren. Bei Netz- oder Serverfehlern wiederholt der Client mit exponentiellem Backoff (1 s … 5 min). Auslöser siehe „Sync-Trigger“.

### Sync-Trigger

Ein Sync-Lauf ist immer Push → Pull (bzw. Re-Sync) und läuft unabhängig von Web Push (Prinzip 4, T-OFF-06), ausgelöst durch (`apps/web/src/sync/triggers.ts`):

- App-Start, Fensterfokus, Tab wird sichtbar (`visibilitychange`), `online`-Event
- Timer: alle 5 Minuten, solange die App sichtbar ist; versteckte Tabs pollen nicht (Akku, Datenvolumen). Ist der Server nicht erreichbar, wird jede Minute neu geprüft.
- Lokale Änderung: 1,5 s entprellt, nur Push/Pull ohne Session- und Workspace-Abgleich
- Web-Push-Hinweis (Phase 4): `onSyncHint` startet nur einen normalen Lauf; Inhalte kommen nie über Push
- „Jetzt synchronisieren“ in der Seitenleiste, „Neu synchronisieren“ (vollständig) auf der Kontoseite

Läufe sind Single-Flight: Im Tab wartet eine Anfrage auf den laufenden Lauf und löst danach genau einen weiteren aus; über Tabs desselben Kontos serialisiert ein Web Lock (`notion-alt-sync:<deviceId>`) die Läufe. Fehler werden mit exponentiellem Backoff (1 s … 5 min) wiederholt. Die Seitenleiste zeigt Verbindung (verbunden / offline / Sitzung abgelaufen mit Link zum Anmelden), Sync-Status (synchronisiert um … / ausstehend / läuft / fehlgeschlagen), ausstehende Operationen sowie Konflikte und Ablehnungen.

### Pull

`GET /api/sync/pull?workspaceId=…&cursor=…&limit=…` (max. 1000) liefert die Changes nach dem Cursor in `seq`-Reihenfolge, den neuen Cursor und `hasMore`. Der Client (`pullWorkspace`) holt nach jedem Push für jeden Workspace Seite um Seite und wendet sie mit `LocalStore.applyRemoteChanges` an. Eine Seite und ihr Cursor (`meta.syncCursor:<workspaceId>`) werden in **einer** Dexie-Transaktion gespeichert; ein Abbruch wiederholt höchstens diese Seite. Regeln beim Anwenden:

- Es entstehen **keine** neuen Queue-Einträge.
- Eigene Changes (gleiche `op_id` in der Queue oder eigene `device_id`) bestätigen nur: Der Queue-Eintrag wird entfernt (falls die Push-Antwort verloren ging) und die Revision gespeichert.
- Hat die Entität noch ungesyncte lokale Operationen, bleibt sie unverändert. Ihr Push trifft dann auf den Konfliktpfad, statt still überschrieben zu werden.
- `delete` setzt `deletedAt` (Tombstone), siehe Löschungen. Links (Backlinks) werden nachgeführt, und die Suche indiziert betroffene Dokumente über `onChange` neu.
- Der Editor übernimmt entfernte Änderungen auch in einem fokussierten Block, solange dort keine ungespeicherte Eingabe läuft; die Cursorposition bleibt erhalten.

### Vollständiger Re-Sync

- `GET /api/sync/snapshot?workspaceId=…` liefert alle Dokumente, Blöcke, Tags und Tag-Zuordnungen des Workspaces **inklusive Tombstones** sowie den Cursor, zu dem der Stand gehört (gelesen in einer Transaktion). Im MVP ungeteilt; bei sehr großen Workspaces später paginieren oder streamen.
- `GET /api/sync/log?workspaceId=…&cursor=…&limit=…` liefert das Änderungslog für den JSON-Export (ADR 0004). Wie `pull`, aber ohne `410`: Nach einer Kompaktierung beginnt es beim ältesten noch vorhandenen Eintrag; `compactedSeq` zeigt, bis wohin der Verlauf fehlt.
- **Restore eines älteren Server-Backups:** Ein Cursor, der über dem höchsten `seq` des Servers liegt, wird mit `410 cursor_ahead` beantwortet. Der Restore-Befehl hebt zusätzlich `compacted_seq` um 1 000 000 an, sodass jedes Gerät neu synchronisiert und neue `seq` nie Nummern wiederholen, die Geräte vor dem Restore gesehen haben. Beim Snapshot behält der Client Entitäten, die der Server nicht mehr kennt, und sendet sie als `create` erneut (Eltern zuerst); ist sein synchronisierter Stand neuer als der des Snapshots (höhere Revision), sendet er die Unterschiede als `update`/`move`/`delete` gegen die Server-Revision – der Server merged oder zeigt einen Konflikt. Nichts wird still verworfen.
- `workspaces.compacted_seq` merkt sich, bis zu welcher `seq` das Log kompaktiert wurde (Migration `0004`). `pull` mit älterem Cursor antwortet `410 cursor_expired`. Eine Kompaktierung läuft im MVP nicht; `compactChangeLog` (`apps/server/src/sync/changes.ts`) dient als Testhaken und spätere Grundlage. Die Nummerierung setzt nach einer Kompaktierung oberhalb von `compacted_seq` fort.
- Der Client (`syncWorkspace`) lädt einen Snapshot statt der Deltas, wenn das Gerät den Workspace noch nie synchronisiert hat (Cursor 0, neues Gerät), wenn `pull` `410` liefert oder wenn der Nutzer „Neu synchronisieren“ (Kontoseite) wählt. Die Queue wird vorher gepusht. `LocalStore.replaceWithSnapshot` ersetzt den lokalen Stand des Workspaces in **einer** Transaktion, baut den Link-Index neu auf und setzt den Cursor; Entitäten mit ungesyncten Operationen behalten ihren lokalen Stand, die Queue bleibt unverändert (T-MD-05). Danach folgt ein normaler Pull.

### Serverseitige Suche

FTS5-Tabelle `search_index` (Migration `0005`, mit Initialbefüllung): eine Zeile pro aktiver Seite mit Titel und Blocktext (Markdown-Inline zu Text normalisiert, Code unverändert), Tokenizer `unicode61 remove_diacritics 2` („uber“ findet „über“). Die Zeile wird über eine stabile Rowid angesprochen (Tabelle `search_documents`, Migration `0009`), nie über die nicht indexierte Spalte `document_id`. `applyOperation` markiert die betroffene Seite in derselben Transaktion in `search_dirty` (Migration `0010`); neu aufgebaut wird jeder markierte Eintrag einmal am Ende des Push-Requests, vor jeder Suche und beim Start des Servers, sodass weder ein Absturz noch ein langer Batch einen veralteten Index hinterlässt (#99). Gelöschte Seiten und Blöcke verschwinden aus dem Index. `GET /api/search?workspaceId=…&q=…` liefert bis zu 20 Treffer mit Snippet, nur im eigenen Workspace; jedes Wort wird als Präfix gesucht, FTS-Syntax in der Eingabe wird nie ausgewertet. Im Client bleibt die lokale Suche (MiniSearch) maßgeblich; online ergänzen Serverergebnisse sie unter „Weitere Treffer vom Server“, z. B. für Seiten, die noch nicht auf dem Gerät sind (Klick synchronisiert zuerst).

### Löschungen (Tombstones)

- `delete` setzt `deleted_at` und erhöht die Revision; die Zeile bleibt (keine Kompaktierung im MVP).
- Eine Seite mit Unterseiten erzeugt je Seite eine `delete`-Operation (T-DEL-03). Blöcke und Tag-Zuordnungen einer gelöschten Seite bekommen **keine** eigenen Tombstones: Sie sind über den Tombstone ihrer Seite ausgeblendet und bleiben unverändert, damit eine spätere Wiederherstellung (Phase 5) die Seite vollständig zurückbringt.
- Ändert ein Gerät eine Entität, die ein **anderes** Gerät gelöscht hat, ist das Ergebnis `conflict` mit `reason: deleted`. Ändert oder ergänzt es Blöcke bzw. Tags einer von einem anderen Gerät gelöschten Seite, ist das Ergebnis `conflict` mit `reason: parent_deleted` (T-DEL-02). Nichts verschwindet still im Tombstone.
- Erneutes Löschen einer gelöschten Entität antwortet `duplicate` (gleiche Wirkung).
- **Papierkorb (#66):** Die Operation `restore` (nur für Seiten) hebt den Tombstone wieder auf; die Seite behält ihre ID, Links funktionieren weiter, Blöcke/Tags/Anhänge sind unverändert da. Der Client stellt gelöschte Unterseiten mit wieder her. Wiederholtes Wiederherstellen ist `duplicate`. Anhänge bleiben nach dem Löschen `ATTACHMENT_RETENTION_DAYS` lang erhalten; die Seiten selbst unbegrenzt (keine Kompaktierung im MVP).
- Der Pull wendet den Tombstone einer Seite nicht an, solange das Gerät ungesyncte Änderungen an der Seite oder ihren Blöcken hat. Deren Push wird zum Konfliktobjekt; sobald es per Pull ankommt, übernimmt das Gerät den Tombstone, und die Änderung lässt sich in der Konfliktansicht als neue Seite wiederherstellen.

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
