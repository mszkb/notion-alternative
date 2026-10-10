# Vision, Zielgruppen & Scope

## Motivation

Notion nervt mit seinem „always on“. Die Offline-Funktion existiert, ist aber kaum nutzbar. Echte self-hosted Alternativen gibt es kaum – und wenn, ist der mobile Client (insbesondere iOS) schwach.

## Produktziel

- Eine lokale, exportierbare und self-hostbare Wissens- und Dokumentenplattform mit moderner Web-App und installierbarer PWA.
- Daten bleiben auf dem Gerät nutzbar, wenn der eigene Server oder das Internet ausfällt.
- Der MVP fokussiert auf Dokumente, Seiten, Suche, Tags, Anhänge und **zuverlässige Synchronisierung** – nicht auf vollständige Notion-Feature-Parität.
- **Super einfach, minimales Setup.** Die App soll sich so einfach einrichten und benutzen lassen wie möglich (siehe [Einfachheit und minimales Setup](#einfachheit-und-minimales-setup)).

## Einfachheit und minimales Setup

Die App wird so gebaut, dass sie **super einfach** ist – beim Einrichten, im Betrieb und in der Bedienung. Wer die App ausprobieren will, soll nicht erst eine Anleitung durcharbeiten müssen.

- **Minimalster Setup.** Hochladen bzw. starten, Adresse öffnen, Konto anlegen – fertig. Keine Pflicht-Konfiguration, keine zusätzlichen Dienste (keine externe Datenbank, kein Redis, kein eigener Mailserver), keine Kommandozeile für den Normalfall.
- **Sinnvolle Voreinstellungen.** Alles, was eingestellt werden kann, funktioniert ohne Einstellung. Optionen sind die Ausnahme und nie Voraussetzung für die Grundfunktionen.
- **Wenige bewegliche Teile.** Eine SQLite-Datei, Dateien im Volume, ein Release-ZIP für Webhosting oder zwei Container mit Docker Compose. Jede neue Abhängigkeit oder jeder neue Dienst muss diesen Aufwand rechtfertigen.
- **Updates, Backup und Restore ohne Fachwissen.** Ein Update ist das Austauschen von Dateien bzw. Images; Migrationen laufen von selbst.
- **Im Zweifel weglassen.** Ein Feature, das den Setup oder die Bedienung spürbar komplizierter macht, wird vereinfacht, verschoben oder nicht gebaut.

### Ohne Anmeldung loslegen

Die App lässt sich **sofort ohne Konto und ohne Login** benutzen. Seiten entstehen im lokalen Speicher des Geräts; Local-first macht das möglich, der Server ist dafür nicht nötig. Anmelden ist **opt-in**: Erst wer synchronisieren, ein zweites Gerät nutzen oder teilen will, meldet sich an oder legt ein Konto an.

Beim späteren Anmelden werden die bereits lokal erstellten Seiten **intelligent übernommen**, ohne dass etwas verloren geht oder still überschrieben wird:

| Situation | Verhalten |
| --- | --- |
| Neuer Host, noch kein Workspace | Konto und Workspace werden angelegt, die lokalen Seiten landen ohne Rückfrage darin. |
| Host hat schon Workspaces bzw. Seiten | Die App fragt, wohin die lokal erstellten Seiten kommen: in einen bestehenden Workspace (als eigener Bereich im Seitenbaum) oder in einen neuen Workspace. |
| Sofort an einem bestehenden Host angemeldet, lokal noch nichts erstellt | Kein Zusammenführen nötig: anmelden und wie gewohnt synchronisieren. |

Das ändert die lokale Datenschicht (heute eine Dexie-Datenbank pro Benutzerkonto, [ADR 0009](../adr/0009-local-data-layer.md)) und braucht vor der Umsetzung einen eigenen ADR.

## Zielgruppen

Festgelegt in [#17](https://github.com/mszkb/notion-alternative/issues/17) (2026-10-07).

### Primär: Umsteiger von Notion

Menschen, die Notion heute für Notizen, persönliches Wiki oder Wissenssammlung nutzen und davon weg wollen, weil Notion ohne Netz kaum nutzbar ist oder weil ihre Daten nicht bei einem SaaS-Anbieter liegen sollen. Ausdrücklich **auch weniger technikaffine Nutzer**: Sie kennen Notion, nicht Docker oder Markdown.

Daraus folgt:

- **Vertraute Bedienung schlägt eigene Konzepte.** Was in Notion funktioniert (Seitenleiste mit Seitenbaum, Slash-Menü, Tastenkürzel, Blocktypen wie To-do und Toggle, Seiten-Icons), wird übernommen, soweit es die Prinzipien zulassen ([#130](https://github.com/mszkb/notion-alternative/issues/130)).
- **Der Umzug muss leicht sein.** Import aus dem Notion-Export ([#137](https://github.com/mszkb/notion-alternative/issues/137)) gehört zum Kern, nicht zu den Extras.
- **Betrieb ohne Docker-Kenntnisse.** Neben Docker Compose braucht es einen Weg über gewöhnliches Webhosting mit fertig eingerichtetem Webserver und HTTPS ([#116](https://github.com/mszkb/notion-alternative/issues/116), [ADR 0011](../adr/0011-https-for-mobile-devices.md)).
- **Begriffe und Hinweise in Alltagssprache.** Sync-Zustand, Konflikte und „offline verfügbar“ werden ohne Fachbegriffe erklärt.

### Sekundär: Self-Hoster und Home-Lab

Technikaffine Nutzer mit eigenem Server oder Raspberry Pi, denen Offline-first, Datenhoheit und sauberer Export wichtig sind. Sie bleiben die Referenz für das Deployment (Docker Compose, [ADR 0010](../adr/0010-reference-deployment-and-https.md)) und sind die ersten, die die App produktiv nutzen. Für Smartphones im Home-Lab ist Tailscale der empfohlene Weg zu HTTPS ([ADR 0011](../adr/0011-https-for-mobile-devices.md)).

### Später: kleine Teams

Sharing, Kommentare und Berechtigungen kommen erst in Phase 8. Bis dahin ist die App für eine Person mit mehreren Geräten gebaut.

### Bewusst nicht

- Unternehmen mit Anforderungen an SSO, SCIM oder Audit-Logs.
- Nutzer, die Notion vor allem für Datenbanken, Projektmanagement oder Echtzeit-Zusammenarbeit verwenden (siehe [Bewusst nicht im MVP](#bewusst-nicht-im-mvp)).

### Szenarien

| Szenario | Was zählen muss |
| --- | --- |
| Persönliches Wiki aus Notion übernehmen | Import mit Seitenhierarchie, Bildern und Links; gewohnte Bedienung ab der ersten Minute |
| Unterwegs auf dem Smartphone ohne Netz nachschlagen und notieren | installierte PWA, Inhalte offline verfügbar, Sync ohne Zutun |
| Notizen am Laptop und Handy parallel | keine still verlorenen Änderungen, Konflikte verständlich erklärt |
| Daten mitnehmen oder sichern | Export als Markdown/ZIP, Backup per Anleitung |

**Positionierung:** Die Notion-Alternative, die offline funktioniert und deren Daten beim Nutzer bleiben: self-hosted oder auf eigenem Webspace, mit offenem Export.

**Konsequenzen für die Priorisierung:** Nach Phase 7 kommt zuerst die vertraute Oberfläche ([#130](https://github.com/mszkb/notion-alternative/issues/130)) mit Notion-Import, danach der einfachere Betrieb über Webhosting ([#116](https://github.com/mszkb/notion-alternative/issues/116)). Ein Import aus Obsidian bleibt eine spätere Idee.

## Produktprinzipien

| Prinzip | Bedeutung |
| --- | --- |
| Local-first | Die lokale Datenbank ist jederzeit lesbar und bearbeitbar. |
| Offline-first | Serverausfälle verhindern nicht den Zugriff auf vorhandene Inhalte. |
| Export first | Markdown, JSON und ZIP müssen verlässlich funktionieren. |
| Push = Hinweis | Push ist nur ein Sync-Hinweis und darf keine Datenintegrität voraussetzen. |
| Keine Feature-Sperren | Self-hosted Einzelanwender erhalten die Kernfunktionen ohne künstliche Sperren. |
| Einfachheit | Minimales Setup ohne Pflicht-Konfiguration; sofort ohne Login nutzbar, Anmeldung ist opt-in. |
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
