# 0015 – Echtzeit-Verteilung von Änderungen

- **Status:** Proposed
- **Datum:** 2026-10-03

## Kontext

[ADR 0002](0002-sync-protocol.md) und [ADR 0003](0003-conflict-resolution.md) halten zwei Fragen für Phase 8 offen ([#81](https://github.com/mszkb/notion-alternative/issues/81)):

- CRDT bzw. operationsbasierter Sync innerhalb eines Blocks.
- Ein zusätzlicher Kanal neben REST, über den Änderungen zeitnah ankommen.

Heute läuft der Sync per REST: beim Start, bei Fokuswechsel, periodisch und nach einem Push-Hinweis. Gleichzeitige Änderungen am selben Feld desselben Blocks ergeben ein Konfliktobjekt.

Echtzeit-Kollaboration mit Cursor-Präsenz ist laut [`CLAUDE.md`](../../CLAUDE.md) kein Teil des MVP. Offline-first bleibt Pflicht. Das Markdown-Export ([ADR 0004](0004-export-format.md)) muss lesbar bleiben.

## Optionen

1. **Hinweiskanal (Server-Sent Events) und weiter Block-Merge:**
   - Der Server schickt über `GET /api/sync/events` dieselben Hinweise wie per Push (`sync_available` und Workspace, ohne Inhalte). Der Client macht daraufhin einen Delta-Pull.
   - **+** Keine neue Abhängigkeit. SSE ist einseitig und läuft ohne Sonderkonfiguration durch nginx (`proxy_buffering off` für die Route).
   - **+** REST bleibt die einzige Datenquelle. Fällt der Kanal aus, ändert sich nichts an der Korrektheit.
   - **−** Gleichzeitiges Tippen im selben Block ergibt weiterhin einen Konflikt, der aber nur sichtbar wird, wenn beide wirklich gleichzeitig schreiben.
2. **WebSocket mit Operationen und Präsenz:**
   - **+** Beidseitig: Operationen gehen schneller hin und zurück, Präsenz ist möglich.
   - **−** Ein zweiter Schreibpfad neben `/api/sync/push`, der dieselben Invarianten erfüllen muss (Idempotenz, Reihenfolge). Dazu Verbindungsverwaltung und nginx-Konfiguration.
3. **CRDT pro Block (z. B. Yjs `Y.Text`):**
   - **+** Gleichzeitiges Bearbeiten desselben Blocks ohne Konflikt.
   - **−** Neue, große Abhängigkeit und ein binäres Zustandsformat pro Block, das wächst und kompaktiert werden muss.
   - **−** Der Markdown-Export braucht einen materialisierten Text, Verlauf und Diff müssen umgebaut werden.
   - **−** Bestehende Inhalte müssen migriert werden. Lokale Datenbank, Server und JSON-Export ändern sich.

## Entscheidung (Vorschlag)

Stufe 1 ist Option 1.

- Der Kanal ist ein reiner Beschleuniger. Sync bei Start, Fokuswechsel und periodisch bleibt (Prinzip 4).
- Der Client verbindet sich nur, solange die App sichtbar ist, und trennt die Verbindung im Hintergrund. Der Server begrenzt Verbindungen pro Konto.

Option 3 wird erst entschieden, wenn Konflikte durch gleichzeitiges Tippen in der Praxis häufig sind. Messgröße: Anteil der Konfliktobjekte mit `reason: changed` am selben Feld, sichtbar über Metriken.

Präsenz („wer ist auf der Seite“) und Option 2 werden zurückgestellt.

## Konsequenzen

- Für Stufe 1 braucht es:
  - Endpunkt und Benachrichtigung über denselben `pushNotifier`-Pfad.
  - nginx-Route ohne Pufferung.
  - Client-Verbindung mit Backoff.
  - Tests: Hinweis löst Pull aus, Kanalausfall ändert nichts, kein Inhalt im Ereignis.
- Ohne CRDT bleibt das Akzeptanzkriterium „gleichzeitiges Bearbeiten desselben Blocks ohne Konflikt-Dialog“ aus #81 offen. Es gilt nur, „wenn CRDT gewählt“.
- Hängt von [ADR 0014](0014-sharing-and-permissions.md) ab: Erst mit mehreren Mitgliedern lohnt sich der Kanal spürbar. Für mehrere Geräte eines Kontos reicht Push.
