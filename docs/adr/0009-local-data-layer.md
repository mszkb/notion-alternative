# 0009 – Lokale Datenschicht, Operationen und Suche

- **Status:** Accepted
- **Datum:** 2026-10-02

## Kontext

[ADR 0001](0001-local-storage.md) legt IndexedDB über Dexie fest und lässt die Suchbibliothek offen. [ADR 0002](0002-sync-protocol.md) definiert Operationen, die ab Phase 3 synchronisiert werden. In Phase 2 gibt es noch keinen Sync – trotzdem soll jede Änderung bereits eine Operation in der Offline-Queue erzeugen, damit Phase 3 nur noch den Transport ergänzt. Die App muss ohne Server nutzbar sein, sobald sie geladen ist (AC-01, AC-08).

## Entscheidung

### Datenbank pro Benutzer

- Eine Dexie-Datenbank pro Benutzerkonto und Browser: `notion-alt-<userId>`. Mehrere Konten im selben Browser sehen nie die Daten des anderen.
- Tabellen:

| Tabelle | Inhalt | Synchronisiert |
| --- | --- | --- |
| `meta` | Schlüssel/Wert, u. a. `deviceId` (stabil pro Installation) | nein |
| `workspaces` | Zwischenspeicher der Workspaces vom Server | nein (Serverdaten) |
| `documents`, `blocks`, `tags`, `documentTags` | Inhalte | ja (ab Phase 3) |
| `operations` | Offline-Queue, fortlaufend nummeriert (`seq`) | wird übertragen |
| `links` | Abgeleiteter Index der Seitenlinks pro Block (für Backlinks) | nein (abgeleitet) |

- **Feldnamen in camelCase** (`parentId`, `sortKey`, `deletedAt` …), konsistent mit den bestehenden API-Schemas. Die snake_case-Namen in [sync.md](../architecture/sync.md) und ADR 0002 bezeichnen dieselben Felder.
- Typen und zod-Schemas liegen in `packages/shared` (Server validiert in Phase 3 mit denselben Schemas).

### Operationen

- Jede Schreibfunktion der Datenschicht ändert Inhalt **und** hängt die Operation(en) in **einer** Dexie-Transaktion an `operations` an. Schlägt eins fehl, wird beides zurückgerollt.
- Format nach ADR 0002: `opId` (UUID), `deviceId`, `workspaceId`, `entity`, `entityId`, `kind` (`create` | `update` | `move` | `delete`), `baseRevision`, `payload`, `createdAt`.
- `baseRevision` ist die zuletzt vom Server bestätigte Revision der Entität; lokal neu angelegte Entitäten haben `revision: null`.
- Löschen erzeugt einen **Tombstone** (`deletedAt`), nie ein physisches Löschen. Das Löschen einer Seite markiert den ganzen Teilbaum (eine `delete`-Operation pro Dokument; Blöcke gelöschter Dokumente bleiben unverändert und gelten als mitgelöscht).
- Tastatureingaben werden pro Block entprellt; eine Operation entspricht einer gespeicherten Änderung, nicht einem Tastendruck.
- **Erweiterung von ADR 0002:** Neben `document`, `block`, `tag` gibt es die Entität **`document_tag`** (Zuordnung Tag ↔ Dokument mit eigener UUID, `create`/`delete`). Hinzufügen und Entfernen von Tags sind so unabhängige Operationen, die auf mehreren Geräten ohne Konflikt zusammengeführt werden können; doppelte Zuordnungen werden beim Lesen zusammengefasst.
- `updatedAt` eines Dokuments wird lokal bei jeder Änderung an Titel oder Blöcken fortgeschrieben (für „Zuletzt bearbeitet“), erzeugt aber keine eigene Operation; ab Phase 3 setzt der Server den maßgeblichen Wert.

### Sortierung und IDs

- `sortKey` über die Bibliothek **fractional-indexing** (rocicorp, CC0, ohne Abhängigkeiten). Gleichstand zweier Schlüssel (paralleles Einfügen auf zwei Geräten) wird deterministisch über die ID aufgelöst.
- IDs: `crypto.randomUUID()`; Fallback über `crypto.getRandomValues()`, da `randomUUID` nur in sicheren Kontexten (HTTPS/localhost) verfügbar ist und Self-hosted-Instanzen im LAN auch per HTTP laufen können.

### Lokale Volltextsuche

- **MiniSearch** (klein, typisiert, Präfix- und Fuzzy-Suche, inkrementelles Hinzufügen/Entfernen).
- Index im Speicher pro Workspace; Felder: Titel (höher gewichtet), Klartext der Blöcke (Markdown-Syntax entfernt), Tag-Namen. Aufbau beim Öffnen des Workspaces, danach inkrementell bei jeder Änderung.
- Eine persistente Ablage des Index ist für große Workspaces später möglich (`MiniSearch.toJSON`), im Prototyp nicht nötig.
- *Ergänzung (#98, 2026-10-03):* Der Index wird in IndexedDB gespeichert (Dexie-Version 4, Tabelle `searchIndexes`, `toJSON`/`loadJSON`).
  - **Invalidierung:** Jeder Schreibvorgang des `LocalStore` markiert die betroffenen Seiten in derselben Transaktion in `searchDirty`. Das gilt auch für Pull und Re-Sync. Jede Markierung trägt einen eigenen Wert (`mark`).
  - **Start:** Der Index wird geladen, danach werden nur die markierten Seiten neu indexiert.
  - **Speichern:** Nur Markierungen, die sich seit dem Lesen nicht geändert haben, werden entfernt. Eine Änderung während des Speicherns wird daher beim nächsten Start nachgezogen. Andere Tabs sind eingeschlossen.
  - Gespeichert wird nach einem vollständigen Aufbau und wenn beim Start viele Seiten markiert waren, nie während des Bearbeitens: Das Serialisieren eines großen Index blockiert die Seite.
  - **Neuaufbau:** bei mehr als einem Viertel geänderter Seiten (z. B. nach einem Re-Sync), bei anderem Format (`SEARCH_INDEX_FORMAT`) und bei beschädigtem Cache.

### Offline-Zugang und Anmeldung

- Der Router lässt die App auch ohne Server starten: Ist der Server nicht erreichbar, wird der **zuletzt angemeldete Benutzer** (lokal zwischengespeichert: ID und E-Mail, kein Token) verwendet und dessen lokale Datenbank geöffnet.
- Eine abgelaufene Sitzung (`401`) sperrt den lokalen Zugriff nicht; die UI weist auf die erneute Anmeldung hin (siehe ADR 0007, Konsequenzen). Nur **explizites Abmelden** entfernt den zwischengespeicherten Benutzer; die lokalen Daten bleiben erhalten.
- `navigator.storage.persist()` wird beim ersten Öffnen angefragt; der Status („dauerhaft“ / „nicht dauerhaft“ / „nicht unterstützt“) steht in der Seitenleiste.
- Echtes Netz-Offline **beim Neuladen** setzt voraus, dass die App-Dateien gecacht sind – das liefert der Service Worker in Phase 4. Phase 2 deckt ab: Server ausgefallen (Dateien weiter erreichbar) sowie Netzverlust in einer bereits geladenen App.

## Konsequenzen

- Phase 3 liest die Queue in `seq`-Reihenfolge und entfernt bestätigte Operationen; die Datenschicht muss dafür nicht geändert werden.
- Die Erweiterung um `document_tag` muss beim Server-Schema (Phase 3) und beim Export (Phase 6) berücksichtigt werden; `sync.md` ist angepasst.
- Lokale Schema-Änderungen laufen über Dexie-Versionen; ungesyncte Operationen müssen sie überstehen (T-MIG-02).
- Explizites Abmelden auf einem fremden Gerät lässt die lokalen Daten im Browser zurück. Eine Funktion „lokale Daten löschen“ kommt mit der Geräteverwaltung (Phase 3).
- Neue Abhängigkeiten: `dexie`, `minisearch` (Web), `fractional-indexing` (shared); für Tests `fake-indexeddb` und `@playwright/test`.
