# 0023 – Lokaler Bereich ohne Konto und Übernahme beim Login

- **Status:** Accepted
- **Datum:** 2026-10-10, angenommen 2026-10-10

## Kontext

Die App soll sich ohne Konto und ohne Login benutzen lassen ([`vision.md`](../product/vision.md), „Ohne Anmeldung loslegen“; Epic [#179](https://github.com/mszkb/notion-alternative/issues/179), Frage [#180](https://github.com/mszkb/notion-alternative/issues/180)). Anmelden ist opt-in. Beim späteren Login werden die lokal erstellten Seiten übernommen, ohne dass etwas verloren geht oder still überschrieben wird.

Heute gilt:

- Eine Dexie-DB pro Konto: `notion-alt-<userId>` ([ADR 0009](0009-local-data-layer.md)). Der Router verlangt einen (zwischengespeicherten) Benutzer.
- Jede Änderung schreibt Entität und Operation in einer Transaktion (`LocalStore`). Operationen tragen `workspaceId` und `deviceId`.
- Die Geräte-ID entsteht im Client. `POST /api/devices` registriert sie mit der vom Client gewählten ID.
- Bei der Registrierung legt der Server einen leeren Workspace „Personal“ an.
- Kopieren mit neuen IDs in einen eigenen Workspace gibt es schon (Rettung abgelehnter Änderungen, ADR 0014; Import als Kopie, ADR 0004).

Prinzipien, die betroffen sind:

- Local-first und offline-first: Ohne Konto ist die App vollständig nutzbar.
- Keine stillen Überschreibungen.
- Export first: Export und Import funktionieren ohne Konto.
- Sync-Invarianten: eindeutige Operation-IDs, idempotente Übertragung, Tombstones, Re-Sync jederzeit.

## Optionen

### A. Lokale Datenbank ohne Konto

1. **Eigene DB `notion-alt-local`** mit demselben Schema und denselben Dexie-Versionen wie die Konto-DBs. Sie enthält genau einen lokalen Workspace (clientseitige UUID, Name „Auf diesem Gerät“, Rolle `owner`, im Workspace-Cache als `local` markiert).
   - **+** Der `LocalStore` bleibt unverändert, alle Funktionen (Editor, Suche, Tags, Verlauf, Export) laufen ohne Sonderfälle.
   - **+** Konto-DBs bleiben getrennt: Mehrere Konten im selben Browser sehen sich weiterhin nie.
2. **Gleich eine Konto-DB mit Platzhalter-ID** (`notion-alt-<uuid>`), die beim Login umbenannt wird.
   - **−** IndexedDB kann keine Datenbank umbenennen; „Umbenennen“ wäre ohnehin Kopieren.
   - **−** Meldet sich ein anderes Konto an als gedacht, gehören die Daten plötzlich diesem Konto.

### B. Übernahme beim Login

1. **Queue aufheben und pushen:** Die ohne Konto entstandenen Operationen werden beim Login übertragen, der lokale Workspace wird mit derselben ID auf dem Server angelegt.
   - **+** Feingranularer Verlauf bleibt erhalten.
   - **−** Braucht einen neuen Endpunkt „Workspace mit vorgegebener ID anlegen“.
   - **−** Für „in einen bestehenden Workspace“ müssten alle Operationen umgeschrieben werden (`workspaceId`, Elternseite). Umgeschriebene Operationen mit alten `opId`s widersprechen der Idempotenz, neue `opId`s machen den Vorteil zunichte.
   - **−** Eine lange Queue (Wochen ohne Konto) wird beim ersten Login komplett übertragen.
2. **Server-Import (`POST /api/import`) des lokalen Workspace als JSON-Export:**
   - **+** Vorhanden und erprobt, inklusive Anhängen über den normalen Upload.
   - **−** Legt immer einen neuen Workspace an; „in einen bestehenden Workspace“ geht damit nicht.
   - **−** Zwei Wege für die beiden Fälle des Epics.
3. **Lokale Übernahme in die Konto-DB, dann normaler Sync (empfohlen):** Nach dem Login öffnet die App die Konto-DB, legt bei Bedarf den Ziel-Workspace an (`POST /api/workspaces`) und schreibt alle aktiven Entitäten des lokalen Bereichs über den `LocalStore` in den Ziel-Workspace. Der Sync überträgt sie wie jede andere Änderung.
   - **+** Ein einziger Weg für „neuer Workspace“ und „bestehender Workspace“.
   - **+** Kein neuer Endpunkt; Rechte nach ADR 0014 gelten unverändert (Ziel nur mit Rolle ab `editor`).
   - **+** Neue Operationen mit neuen `opId`s und der Geräte-ID dieses Geräts; die Sync-Invarianten gelten wie immer.
   - **−** Der lokale Verlauf vor dem Login (viele kleine Operationen) kommt nicht auf den Server; dort beginnt der Verlauf mit der Übernahme. Der Inhalt ist vollständig.

## Entscheidung

**A1 und B3** (vom Maintainer angenommen, 2026-10-10).

### Ohne Konto

- Beim ersten Öffnen ohne zwischengespeicherten Benutzer öffnet der Router `notion-alt-local` und den lokalen Workspace. Er ist eine leere Seite bzw. eine Willkommensseite, kein Login-Bildschirm.
- Die Geräte-ID entsteht wie heute in `meta` und wird erst nach dem Login mit `POST /api/devices` registriert (gleiche ID).
- Kein Netzwerkverkehr zum Server, solange niemand anmelden will. Erst der Dialog „Anmelden“ fragt `GET /api/auth/status`.
- Sync, Geräte, Mitglieder, Lese-Links, serverseitige Suche und Push zeigen „Anmelden, um … zu nutzen“ statt eines Fehlers.
- Anhänge liegen nur lokal (IndexedDB, wie offline angelegte Anhänge heute) und werden nach der Übernahme vom normalen Sync hochgeladen.

### Übernahme beim Login

| Situation | Ziel | Rückfrage |
| --- | --- | --- |
| Lokal nichts erstellt (keine aktive Seite) | – | keine; der lokale Bereich wird verworfen |
| Konto hat keine Seiten (z. B. frisch registriert: leerer „Personal“) | dieser Workspace, Seiten auf oberster Ebene | keine |
| Konto hat Seiten | Auswahl: bestehender Workspace (ab `editor`) oder neuer Workspace | „Wohin mit deinen Seiten?“ |

- **In einen bestehenden Workspace** kommen die Seiten unter eine neue Elternseite „Von diesem Gerät (TT.MM.JJJJ)“ am Ende der obersten Ebene; das Datum hält mehrere Übernahmen auseinander. In einen neuen Workspace kommen sie auf die oberste Ebene.
- **IDs:** Seiten, Blöcke, Tags, Zuordnungen und Anhänge behalten ihre UUIDs. Damit ist die Übernahme idempotent: Was es in der Konto-DB schon gibt, wird übersprungen. Kollisionen sind bei UUIDs nicht zu erwarten. Gibt es die ID trotzdem schon (z. B. weil eine Kopie dieser Daten früher importiert wurde), bekommt die Entität eine neue ID, und Seitenlinks werden mitgezogen, wie beim Import als Kopie.
- **Tags mit gleichem Namen** (ohne Groß-/Kleinschreibung) werden im Ziel-Workspace wiederverwendet statt doppelt angelegt.
- **Papierkorb:** Gelöschte Seiten des lokalen Bereichs werden nicht übernommen; sie bleiben bis zum Aufräumen im lokalen Bereich und gehen mit dessen Export mit.

### Abbruch und Wiederaufnahme

- Der Fortschritt steht in `meta` der lokalen DB: `takeover = { userId, workspaceId, parentId, startedAt }`. Er wird gesetzt, bevor die erste Entität geschrieben wird.
- Die Übernahme schreibt in Paketen (je Seite eine Transaktion in der Konto-DB). Bricht sie ab (Tab geschlossen, Absturz), setzt der nächste Start mit demselben Ziel fort. Bereits übernommene IDs werden übersprungen, nichts entsteht doppelt.
- Offline nach dem Login: Die Übernahme ist rein lokal und läuft trotzdem; der Sync überträgt später.
- Erst wenn alle Operationen der übernommenen Seiten vom Server bestätigt sind, wird `notion-alt-local` gelöscht. Bis dahin bleibt sie als Sicherung bestehen und ist über „Export“ erreichbar.
- Lehnt der Server Operationen ab (z. B. Kontingent für Anhänge erschöpft), greift die bestehende Ansicht „vom Server abgelehnt“ (ADR 0014). Nichts verschwindet still.

### Mehrere Konten, Abmelden

- Der lokale Bereich gehört keinem Konto. Das erste Konto, das sich anmeldet und die Übernahme abschließt, bekommt die Seiten.
- Nach dem Abmelden erscheint wie heute die Anmeldung. Sie bietet zusätzlich **„Ohne Konto weiterarbeiten“**: Das öffnet den lokalen Bereich (nach einer abgeschlossenen Übernahme einen neuen, leeren), später lässt sich wieder anmelden. Die Konto-DB bleibt wie heute im Browser (ADR 0009).
- Der Dialog „Wohin mit deinen Seiten?“ bietet kein „Später“: „Neuer Workspace“ ist immer eine sichere Wahl, und so ist nie mehr als eine lokale Datenbank offen.
- Ein zwischengespeicherter Benutzer hat Vorrang: Wer angemeldet ist, sieht seine Workspaces, nicht den lokalen Bereich.

### Server

Keine neuen Endpunkte: `POST /api/workspaces`, `POST /api/devices` und `POST /api/sync/push` reichen. Registrierung und Login bleiben unverändert.

## Konsequenzen

- Der Router bekommt einen Modus „ohne Konto“. `openLocalStore` öffnet für ihn `notion-alt-local`; alle Ansichten laufen unverändert, serverabhängige Funktionen zeigen einen Hinweis zum Anmelden (#181, #183).
- Neues Modul für die Übernahme mit Tests für Wiederaufnahme, Idempotenz, Tags und Anhänge (#182). Die Testmatrix bekommt einen Abschnitt „Ohne Konto“ (#184).
- Der Verlauf auf dem Server beginnt bei der Übernahme; der lokale Verlauf davor geht in die Seiten ein, nicht als einzelne Versionen.
- Kein neues Exportformat und keine neue Dexie-Version: Die lokale DB hat dasselbe Schema.

### Entschieden vom Maintainer (2026-10-10)

- Kein „Später“ im Dialog „Wohin mit deinen Seiten?“.
- Nach dem Abmelden die Anmeldung wie heute, mit „Ohne Konto weiterarbeiten“.
- Der lokale Verlauf vor dem Login muss nicht auf den Server; die Inhalte werden vollständig übernommen.
- Elternseite „Von diesem Gerät“ mit Datum.
