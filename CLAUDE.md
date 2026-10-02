# CLAUDE.md

Leitfaden für Claude Code (und andere Agents) in diesem Repository.

## Projekt in einem Satz

Self-hosted, **local-first / offline-first** Wissens- und Dokumentenplattform (Notion-Alternative) mit installierbarer PWA. Daten bleiben auf dem Gerät nutzbar, auch wenn Server oder Internet ausfallen.

## Status

Phase 0 (Discovery). Es existiert noch kein Code. Der Tech-Stack ist **vorgeschlagen, aber nicht entschieden** – Entscheidungen werden als ADRs in `docs/adr/` getroffen. Keine Frameworks/Abhängigkeiten einführen, deren ADR noch auf `Proposed` steht, ohne Rücksprache.

## Wo steht was

| Datei / Ordner | Inhalt |
| --- | --- |
| `ROADMAP.md` | Phasen 0–9, Milestones, Fortschritt (Checklisten) |
| `docs/product/` | Vision, Zielgruppen, Prinzipien, MVP-Scope, Nicht-Ziele, Akzeptanzkriterien |
| `docs/architecture/` | Architekturüberblick, Datenmodell & Sync, Push-Strategie |
| `docs/adr/` | Architecture Decision Records (Vorlage: `0000-template.md`) |
| `docs/process/` | Definition of Done, Aufgabenzerlegung für den Roadmap-Agenten |
| `docs/testing/` | Testmatrix (offline/online, Mehrgeräte, Konflikte, Backups, Migrationen) |

Bei Fragen zu Scope oder Architektur zuerst dort nachlesen, nicht raten.

## Nicht verhandelbare Produktprinzipien

Jede Änderung muss diese Prinzipien einhalten. Wenn eine Aufgabe dagegen verstößt, darauf hinweisen statt sie umzusetzen.

1. **Local-first:** Die lokale Datenbank ist jederzeit lesbar und bearbeitbar.
2. **Offline-first:** Serverausfall verhindert nie den Zugriff auf lokal vorhandene Inhalte.
3. **Export first:** Markdown-, JSON- und ZIP-Export müssen verlässlich funktionieren und wieder importierbar sein.
4. **Push ist nur ein Hinweis:** Datenintegrität darf nie von Push-Zustellung abhängen. Sync läuft auch bei Start, Fokuswechsel und periodisch.
5. **Keine künstlichen Feature-Sperren** für Self-hosted Einzelanwender.
6. **Keine stillen Überschreibungen:** Kein verstecktes Last-write-wins. Konflikte werden auf Blockebene gemerged oder sichtbar zur Entscheidung angezeigt.

## Sync-Invarianten (bei jeder Sync-relevanten Änderung prüfen)

- Jede lokale Änderung hat eine eindeutige Operation-ID und wird **idempotent** übertragen.
- Löschungen erzeugen **Tombstones**.
- Delta-Sync über Cursor; ein **vollständiger Re-Sync** muss immer möglich sein.
- Push-Payload enthält **keine Inhalte**, nur `sync_available` + Workspace-/Installationsreferenz (+ optional Badge).

Details: `docs/architecture/sync.md`, `docs/architecture/push.md`.

## Nicht im MVP

Relationale Datenbanken mit vielen Views, Echtzeit-Kollaboration/Cursor-Präsenz, Whiteboard/Kalender/PM, KI-Assistent, Template-Galerie, Enterprise-SSO/SCIM/Audit-Logs, native iOS-App. Solche Features nicht ungefragt bauen; ggf. als Idee für spätere Phasen notieren.

## Arbeitsweise

- **Sprache:** Dokumentation und Issues auf Deutsch. Code, Bezeichner, Commit-Messages und Code-Kommentare auf Englisch.
- **Architekturentscheidungen** immer als ADR festhalten (`docs/adr/NNNN-titel.md`, Status `Proposed` → `Accepted`/`Rejected`/`Superseded`).
- **Roadmap pflegen:** Erledigte Punkte in `ROADMAP.md` abhaken; Scope-Änderungen in `docs/product/` nachziehen.
- **Definition of Done** (`docs/process/definition-of-done.md`) gilt für jede Aufgabe: Tests, Security, Doku, reproduzierbares Deployment.
- Sync-, Konflikt- und Export-Code braucht Tests für die Fälle aus `docs/testing/test-matrix.md`.
- Kleine, fokussierte Commits; keine unbeteiligten Refactorings mitliefern.

## Befehle

Noch keine – sobald Phase 1 (Monorepo, CI, Docker Compose) steht, hier Build-, Test-, Lint- und Dev-Befehle eintragen.
