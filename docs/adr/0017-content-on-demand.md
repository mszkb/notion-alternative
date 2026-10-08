# 0017 – Seiteninhalte bei Bedarf laden

- **Status:** Accepted
- **Datum:** 2026-10-05, angenommen 2026-10-07

## Kontext

Heute lädt ein neues Gerät beim ersten Sync den ganzen Workspace in die lokale Datenbank: alle Seiten, alle Blöcke, den Link-Index und die Suchmarken (ADR 0002, ADR 0009). Bei 10 000 Seiten und 500 000 Blöcken dauert das im Browser 5,2 Minuten, und die lokale Datenbank wird mehrere hundert MB groß ([#102](https://github.com/mszkb/notion-alternative/issues/102), [`load-tests.md`](../testing/load-tests.md)). Auf einem Smartphone ist beides schlechter.

Anhänge werden schon heute nur bei Bedarf geladen (ADR 0012). Ihr Inhalt kommt erst, wenn eine Seite ihn zeigt, und bleibt dann auf dem Gerät.

Wunsch des Maintainers in [#96](https://github.com/mszkb/notion-alternative/issues/96) (2026-10-05):

- Nicht alles herunterladen, sondern bei Bedarf.
- Ein Knopf in den Einstellungen synchronisiert alles auf einmal, mit Fortschrittsbalken.

Betroffene Prinzipien und Kriterien:

- **Local-first / Offline-first (Prinzip 1 und 2):** Die lokale Datenbank bleibt jederzeit lesbar und bearbeitbar. Sie enthält aber nur noch, was geladen wurde. Ein Serverausfall verhindert weiterhin nicht den Zugriff auf **lokal vorhandene** Inhalte (AC-08). Nicht geladene Seiten sind offline nicht verfügbar.
- **AC-01** („Dokumente ohne Netzwerk öffnen und bearbeiten“) gilt dann für geladene Dokumente. Wer alles offline braucht, nutzt den Knopf. Das ist eine Änderung des Produkt-Scopes und muss in [`acceptance-criteria.md`](../product/acceptance-criteria.md) nachgezogen werden.
- **Export first (Prinzip 3):** Der Export entsteht heute clientseitig aus der lokalen Datenbank (ADR 0004). Ein Export muss vorher fehlende Inhalte laden oder klar sagen, was fehlt.
- **Keine stillen Überschreibungen (Prinzip 6):** Bearbeiten lässt sich nur eine geladene Seite. Die Warteschlange bezieht sich damit immer auf geladene Inhalte; Block-Merge und Konflikte bleiben unverändert.

## Optionen

### Was ein neues Gerät sofort bekommt

1. **Alles (heute).**
   - **+** Alles ist sofort offline verfügbar.
   - **−** Erstsync dauert Minuten, belegt viel Speicher und Akku.
2. **Seitenbaum und Metadaten, Inhalte bei Bedarf.** Sofort kommen Seiten (Titel, Baum, Favoriten), Tags, Anhang-Metadaten und Konflikte; Blöcke erst beim Öffnen einer Seite.
   - **+** Der Erstsync dauert Sekunden, auch bei 10 000 Seiten: Die Seiten sind rund 2 % der Einträge. Zum Vergleich: 10 000 Seiten mit je einem Block brauchten im Lasttest rund 10 s.
   - **+** Seitenbaum, Favoriten und Navigation sind sofort vollständig.
   - **−** Nicht geöffnete Seiten fehlen offline.
   - **−** Lokale Suche und Backlinks decken nur geladene Seiten ab.
3. **Wie 2, dazu automatisch die zuletzt geänderten N Seiten.**
   - **+** Die wahrscheinlich gebrauchten Seiten sind sofort offline da.
   - **−** Mehr Logik und eine Grenze, die man erklären muss. Lässt sich später auf 2 aufsetzen.

### Aktualisieren nicht geladener Seiten

1. **Der Client verwirft Block-Änderungen nicht geladener Seiten beim Pull**, behält aber die Revision der Seite. Beim Öffnen holt er den aktuellen Stand.
   - **+** Keine Serveränderung am Pull, der Cursor bleibt einer pro Workspace.
   - **−** Die Änderungen werden übertragen, aber nicht gespeichert. Das ist bei Deltas wenig.
2. **Der Server filtert den Pull nach geladenen Seiten.**
   - **−** Der Server müsste pro Gerät wissen, was geladen ist: neuer Zustand, neue Fehlerquellen.

### Verhalten des Knopfs

1. **Einmal alles laden.** Neue Seiten anderer Geräte kämen danach wieder nur bei Bedarf.
2. **Gerät auf „alles“ umstellen.** Der Knopf lädt alles (Seiten und Anhänge, mit Fortschritt) und merkt sich den Modus. Danach hält der Pull alle Seiten aktuell, wie heute. Ein zweiter Knopf stellt zurück auf „bei Bedarf“; bereits Geladenes bleibt.

## Entscheidung

Angenommen am 2026-10-07 ([#112](https://github.com/mszkb/notion-alternative/issues/112)): **Inhalte bei Bedarf (Option 2), Pull filtert der Client (Option 1), der Knopf stellt das Gerät um (Option 2).** Ergänzung des Maintainers: Das vollständige Laden zeigt einen Fortschrittsbalken und lässt sich jederzeit abbrechen.

- **Erstsync:**
  - `GET /api/sync/snapshot?content=false` liefert alles außer Blöcken.
  - Die lokale Datenbank merkt sich pro Seite, ob ihr Inhalt geladen ist (`loadedDocuments`, neue Dexie-Version). Der Link-Index und die Suchmarken entstehen nur für geladene Seiten.
- **Seite öffnen:**
  - Online lädt `GET /api/sync/documents/:id` die Blöcke der Seite samt `seq` des Lesestands.
  - Der Client schreibt sie in einer Transaktion wie eine Snapshot-Seite. Danach gilt die Seite als geladen, und der Pull hält sie aktuell.
  - Änderungen zwischen lokalem Cursor und `seq` wendet der nächste Pull idempotent an; Revisionen verhindern Rückschritte.
- **Offline, Seite nicht geladen:**
  - Der Editor zeigt „Inhalt ist nicht auf diesem Gerät. Er wird geladen, sobald der Server erreichbar ist.“
  - Nichts lässt sich bearbeiten, keine leere Seite täuscht Inhalt vor.
- **Einstellungen, Abschnitt „Offline verfügbar“:**
  - Der Knopf „Alles offline verfügbar machen“ lädt alle fehlenden Seiteninhalte in Paketen zu 100 Seiten (`POST /api/sync/documents`, damit Abbrechen und Fortsetzen ohne erneuten Gesamtdownload gehen) und alle Anhänge, mit Fortschrittsbalken. Erst wenn alles geladen ist, steht das Gerät auf `offlineMode = all`.
  - „Abbrechen“ beendet das Laden sofort. Was bis dahin geladen ist, bleibt geladen; das Gerät bleibt bei „bei Bedarf“. Ein erneuter Klick setzt fort und lädt nur, was noch fehlt.
  - „Nur bei Bedarf laden“ stellt zurück, Geladenes bleibt.
  - Angezeigt wird, wie viele Seiten geladen sind und wie viel Speicher das belegt.
- **Bestehende Geräte** mit Cursor bleiben bei `all` (Upgrade der Dexie-Version). Für sie ändert sich nichts.
- **Suche:**
  - Online ergänzt die Serversuche (FTS5) die lokale Suche.
  - Offline sagt ein Hinweis, dass nur geladene Seiten durchsucht werden.
  - Backlinks kommen aus dem lokalen Index und zeigen einen Hinweis, solange Seiten nicht geladen sind. Backlinks vom Server folgen bei Bedarf als eigene Aufgabe.
- **Export:**
  - Online lädt der Export fehlende Seiten vorher (wie heute schon fehlende Anhänge).
  - Offline nennt er die nicht geladenen Seiten im Manifest, statt sie still wegzulassen.
- **Nicht in v1:** automatische Vorauswahl (Option 3), Räumen selten genutzter Seiten, „offline verfügbar“ pro Seite.

## Konsequenzen

- Ein neues Gerät ist in Sekunden benutzbar, auch bei sehr großen Workspaces. Der Speicherbedarf wächst mit der Nutzung.
- AC-01 und die Testmatrix (T-OFF-*) werden für „geladene Inhalte“ präzisiert; neue Fälle:
  - nicht geladene Seite offline;
  - Laden beim Öffnen während eines Pulls;
  - Knopf mit Abbruch und Wiederaufnahme;
  - Export mit fehlenden Seiten;
  - Upgrade bestehender Geräte.
- Zwei Wege zu denselben Daten (Snapshot und Einzelabruf) brauchen Tests auf Konsistenz mit dem Cursor (T-MD-07 sinngemäß).
- **Folgeaufgaben nach der Annahme:**
  - Server: `content=false` am Snapshot, Einzelabruf einer Seite.
  - Client: Modus und `loadedDocuments`, Laden beim Öffnen, Pull-Filter, Offline-Hinweis.
  - Einstellungen: Knopf mit Fortschritt.
  - Suche, Backlinks und Export ergänzen.
  - Doku: Akzeptanzkriterien, `sync.md`, Nutzerdoku.
- **Geklärt bei der Annahme:**
  - Option 3 (zuletzt geänderte Seiten automatisch) kommt nicht in v1.
  - Ein installiertes Gerät (PWA) startet wie der Browser mit „bei Bedarf“.
