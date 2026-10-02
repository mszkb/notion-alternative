# Vision, Zielgruppen & Scope

## Motivation

Notion nervt mit seinem „always on“. Die Offline-Funktion existiert, ist aber kaum nutzbar. Echte self-hosted Alternativen gibt es kaum – und wenn, ist der mobile Client (insbesondere iOS) schwach.

## Produktziel

- Eine lokale, exportierbare und self-hostbare Wissens- und Dokumentenplattform mit moderner Web-App und installierbarer PWA.
- Daten bleiben auf dem Gerät nutzbar, wenn der eigene Server oder das Internet ausfällt.
- Der MVP fokussiert auf Dokumente, Seiten, Suche, Tags, Anhänge und **zuverlässige Synchronisierung** – nicht auf vollständige Notion-Feature-Parität.

## Zielgruppen

1. **Einzelanwender und Entwickler**, die Notion-ähnliche Organisation ohne zentrale SaaS-Abhängigkeit möchten.
2. **Self-Hoster** mit Interesse an Offline-first und sauberem Export.
3. **Kleine Teams** – spätere Zielgruppe für Sharing, Kommentare und Governance (Phase 8+).

**Positionierung:** Lokale Wissensbasis mit self-hosted Sync, offenem Export und optionalem Managed Service.

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
