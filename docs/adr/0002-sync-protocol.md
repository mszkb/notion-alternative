# 0002 – Sync-Protokoll

- **Status:** Accepted
- **Datum:** 2026-10-02

## Kontext

Mehrgeräte-Sync muss offline-fähig, idempotent und verlustfrei sein. Siehe [Datenmodell & Sync](../architecture/sync.md). Konflikte werden auf Blockebene behandelt ([ADR 0003](0003-conflict-resolution.md)).

## Optionen

- **Transport:** REST-Batch **oder** WebSocket.
- **Granularität:** Dokument **oder** Block **oder** Feld.

## Entscheidung

Versioniertes Änderungslog auf dem Server, übertragen per **REST-Batch**, mit **Operationen auf Blockebene**.

### Operationen

Jede lokale Änderung erzeugt genau eine Operation:

| Feld | Bedeutung |
| --- | --- |
| `op_id` | UUID, vom Client erzeugt – Idempotency Key |
| `device_id` | Stabile Geräte-ID |
| `workspace_id` | Ziel-Workspace |
| `entity` | `document` \| `block` \| `tag` \| `document_tag` (ergänzt durch [ADR 0009](0009-local-data-layer.md)) |
| `entity_id` | Stabile ID (UUID, vom Client erzeugt) |
| `kind` | `create` \| `update` \| `move` \| `delete` |
| `base_revision` | Revision der Entität, auf der die Änderung beruht (`null` bei `create`) |
| `payload` | Geänderte Felder (bei `update`) bzw. neue Position (bei `move`) |
| `created_at` | Zeitstempel auf dem Gerät (nur informativ, nicht zur Konfliktentscheidung) |

### Endpunkte

- `POST /api/sync/push` – Liste von Operationen (max. 500 pro Request). Antwort pro `op_id`: `applied` (neue Revision), `merged`, `conflict` (Konflikt-ID) oder `duplicate` (bereits angewendet).
- `GET /api/sync/pull?cursor=<n>&limit=<m>` – Changes ab Cursor (max. 1000 pro Seite), plus neuer Cursor und `has_more`.
- `GET /api/sync/snapshot` – vollständiger Stand des Workspaces inkl. aktuellem Cursor, für den **Re-Sync**.
- Antwort `410 Gone` auf `pull`, wenn der Cursor älter als der verfügbare Log ist → Client führt Re-Sync aus.

### Ablauf

1. Push der Offline-Queue (in Reihenfolge der Erzeugung). Erfolgreich bestätigte Operationen werden aus der Queue entfernt; unbeantwortete werden später erneut gesendet – Doppelte erkennt der Server an der `op_id`.
2. Pull ab dem lokalen Cursor, bis `has_more = false`.
3. Trigger: App-Start, Fokuswechsel, Push-Hinweis, periodisch (Standard: alle 5 Minuten bei sichtbarer App).

### Löschungen und Log

- `delete` erzeugt einen **Tombstone** (Entität bleibt mit `deleted_at` erhalten).
- Im MVP **keine Log-Kompaktierung**; Tombstones werden unbegrenzt aufbewahrt. Kompaktierung kommt später – der Re-Sync-Pfad (`snapshot`, `410`) wird trotzdem ab Phase 3 implementiert und getestet (T-MD-05).

## Konsequenzen

- Client und Server teilen Operationstypen und Validierung über ein gemeinsames TypeScript-Paket.
- Der Server vergibt Revisionen pro Entität und eine global monotone Change-Sequenz pro Workspace (= Cursor).
- WebSocket/Echtzeit ist für Phase 8 offen und kann zusätzlich zu REST eingeführt werden.
- Testfälle: T-OFF-03, T-OFF-05, T-MD-01, T-MD-04, T-MD-05, T-DEL-01.
