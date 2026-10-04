# Vision, Zielgruppen & Scope

## Motivation

Notion nervt mit seinem „always on“. Die Offline-Funktion existiert, ist aber kaum nutzbar. Echte self-hosted Alternativen gibt es kaum – und wenn, ist der mobile Client (insbesondere iOS) schwach oder der Betrieb aufwendig (mehrere Dienste, eigene Protokolle, eigenes Datenmodell).

## Produktziel

- Ein **super einfaches, minimalistisches Werkzeug** für Notizen und Dokumente, das man selbst betreibt: Web-App und installierbare PWA, lokal, exportierbar.
- Daten bleiben auf dem Gerät nutzbar, wenn der eigene Server oder das Internet ausfällt.
- Der MVP fokussiert auf Dokumente, Seiten, Suche, Tags, Anhänge und **zuverlässige Synchronisierung** – nicht auf Notion-Feature-Parität. Weniger Funktionen, die dafür verlässlich sind, sind das Ziel, kein Zwischenstand.

**Positionierung:** Das einfachste self-hosted Notizwerkzeug. Ein Server ist in Minuten aufgesetzt, und eine Oberfläche verbindet beliebig viele Spaces von beliebig vielen Servern. Wer nicht selbst betreiben will, mietet einen Hosted Space.

## Spaces von beliebig vielen Servern

Ein **Space** ist ein Workspace auf einem Server – egal ob self-hosted, beim Arbeitgeber, bei Freunden oder als Hosted Space gemietet. Die App bindet Spaces von beliebig vielen Servern in **einer** Oberfläche ein:

- Server hinzufügen heißt: Adresse eingeben, anmelden, fertig. Die Spaces erscheinen nebeneinander in der Seitenleiste.
- Jeder Space bleibt bei seinem Server: eigener Sync, eigene Offline-Kopie, eigener Export. Ein Server, der ausfällt, betrifft nur seine Spaces; alle anderen bleiben lesbar und bearbeitbar.
- Kein Server muss vom anderen wissen. Es gibt keine Föderation zwischen Servern und keinen zentralen Verzeichnisdienst.
- Umzug zwischen Servern (z. B. self-hosted ↔ Hosted Space) heißt: Space exportieren bzw. Backup, auf dem anderen Server importieren bzw. Restore, Server in der App tauschen.

Damit wird auch Teamarbeit einfach, ohne dass das Produkt groß wird: Ein Team betreibt (oder mietet) einen Server, jedes Mitglied fügt ihn neben seinen privaten Spaces hinzu.

**Status:** Vision, noch nicht umgesetzt. Die App spricht heute nur mit dem Server, von dem sie ausgeliefert wird. Die Umsetzung braucht ein eigenes ADR. Offene Punkte dafür:

- Anmeldung über Origins hinweg: Die Session ist heute ein Cookie mit `SameSite=Strict` auf `/api`. Für fremde Server braucht es z. B. Tokens pro Server und CORS.
- Lokale Datenbank: Sie heißt heute `notion-alt-<userId>` ([ADR 0009](../adr/0009-local-data-layer.md)). User-IDs sind nur pro Server eindeutig, die Server-Identität muss in den Namen.
- Wer liefert die App aus? Jeder Server weiterhin selbst; dieselbe App kann dann zusätzlich andere Server einbinden.
- Push ([ADR 0005](../adr/0005-push.md)), Suche und Seitenlinks über mehrere Server hinweg.

## Einfachheitsbudget

Minimalismus ist die Positionierung und muss aktiv verteidigt werden. Jede Änderung hält diese Grenzen ein; wer sie überschreiten will, braucht ein ADR mit Begründung.

- **Betrieb:** höchstens 2 Prozesse (`frontend`, `backend`), keine Pflicht-Dienste wie Redis, Postgres oder S3. Docker ist optional: Ohne Docker heißt es Frontend starten, Backend starten, loslegen ([ADR 0016](../adr/0016-start-without-docker.md)).
- **Daten:** eine SQLite-Datei plus Dateiordner. Backup heißt kopieren, Restore heißt zurückkopieren.
- **Setup:** vom `git clone` bzw. Compose-Datei bis zur ersten Seite in unter 5 Minuten, ohne Pflicht-Konfiguration.
- **Bedienung:** Seiten, Blöcke, Tags, Favoriten, Backlinks, Suche, Anhänge, Verlauf. Ein neues Feature muss begründen, warum es den Kern nicht verwässert.
- **Daten sind lesbar:** Markdown-Export ist ohne die App verständlich.

## Zielgruppen

1. **Einzelanwender und Entwickler**, die ein einfaches Notizwerkzeug ohne zentrale SaaS-Abhängigkeit wollen und es selbst betreiben – auf einem kleinen VPS, NAS oder Raspberry Pi.
2. **Self-Hoster** mit Interesse an Offline-first und sauberem Export, die keine Plattform mit vielen Diensten betreiben wollen.
3. **Kleine Teams** – spätere Zielgruppe für Sharing, Kommentare und Governance (Phase 8+). Am einfachsten über einen gemeinsamen Server, den jedes Mitglied als zusätzlichen Space einbindet.
4. **Nutzer ohne eigenen Server**, die dieselbe Einfachheit wollen und dafür einen Hosted Space mieten.

**Nicht die Zielgruppe:** Wer ein mächtiges Objekt- oder Datenbankmodell sucht (z. B. Anytype, Notion-Datenbanken) oder eine Plattform mit vielen Modulen.

## Geschäftsmodell: Hosted Spaces

Verkauft werden ausschließlich **Hosted Spaces**: Spaces auf einem Server, den der Anbieter betreibt. Die Software selbst bleibt frei (MIT) und vollständig; self-hosted gibt es keine Feature-Sperren.

Ein Hosted Space bietet, was beim Selbstbetrieb Arbeit macht:

- **Betrieb:** Updates, Monitoring, HTTPS, Erreichbarkeit vom Smartphone ohne SSH-Tunnel.
- **Backups:** automatisch, off-site, mit getestetem Restore.
- **Support:** Hilfe bei Problemen, Umzug und Wiederherstellung.
- weitere Goodies, z. B. Push-Zustellung ohne eigene VAPID-Schlüssel oder mehr Speicher für Anhänge.

Ein Hosted Space fügt sich wie jeder andere Server in die App ein. Man kann also mit eigenem Server anfangen und einzelne Spaces hosten lassen, oder umgekehrt – ohne Lock-in, weil Export und Umzug in beide Richtungen funktionieren. Details und offene Fragen: [`paid-services.md`](paid-services.md).

## Produktprinzipien

| Prinzip | Bedeutung |
| --- | --- |
| Local-first | Die lokale Datenbank ist jederzeit lesbar und bearbeitbar. |
| Offline-first | Serverausfälle verhindern nicht den Zugriff auf vorhandene Inhalte. |
| Export first | Markdown, JSON und ZIP müssen verlässlich funktionieren. |
| Push = Hinweis | Push ist nur ein Sync-Hinweis und darf keine Datenintegrität voraussetzen. |
| Keine Feature-Sperren | Self-hosted Einzelanwender erhalten die Kernfunktionen ohne künstliche Sperren. |
| Transparente Konflikte | Konflikte werden sichtbar und nachvollziehbar behandelt, nicht still überschrieben. |

## MVP-Funktionsumfang

- Benutzerkonto, Geräteverwaltung und Workspace
- Verschachtelte Seiten und Dokumente
- Block- oder Markdown-Editor: Überschriften, Text, Listen, Code, Links, Zitate
- Tags, Favoriten, zuletzt bearbeitete Dokumente
- Backlinks und einfache Verlinkung zwischen Seiten
- Volltextsuche lokal und serverseitig
- Dateianhänge mit Größenlimits
- Offline-Lesen und Offline-Bearbeiten
- Mehrgeräte-Synchronisierung
- Konfliktanzeige und Wiederherstellung früherer Versionen
- Export nach Markdown, JSON und ZIP
- PWA mit Web Push
- Docker-Compose-Deployment sowie Backup-/Restore-Dokumentation

## Bewusst nicht im MVP

- Komplexe relationale Datenbanken mit vielen Views
- Echtzeit-Kollaboration und Cursor-Präsenz
- Whiteboard, Kalender, Projektmanagement
- KI-Assistent und automatische Inhaltsgenerierung
- Große Template-Galerie
- Enterprise-SSO, SCIM, umfangreiche Audit-Logs
- Native iOS-App – die PWA ist der erste mobile Client
