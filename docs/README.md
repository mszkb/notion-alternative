# Dokumentation

Abgeleitet aus der ursprünglichen Roadmap-Spezifikation („Roadmap: Self-hosted Notion-Alternative mit offline-first PWA“).

Online lesbar unter <https://mszkb.github.io/notion-alternative/docs/> ([ADR 0025](adr/0025-documentation-site.md)). Lokal: `pnpm --filter @notion-alt/site dev`.

## Anleitungen

- [Installation auf Webspace](user/webhosting.md), [Hochladen per FTP](user/ftp-upload.md), [Einrichtung bei Hostern](user/hoster.md)
- [App installieren](user/installation.md), [Ohne Konto loslegen](user/without-account.md)
- [Seiten bearbeiten](user/editor.md), [Workspaces teilen](user/sharing.md), [Export und Import](user/export.md)

## Produkt

- [Vision, Zielgruppen, Prinzipien & Scope](product/vision.md)
- [Akzeptanzkriterien](product/acceptance-criteria.md)

## Architektur

- [Überblick](architecture/overview.md)
- [Datenmodell & Sync](architecture/sync.md)
- [Push-Strategie](architecture/push.md)

## Entscheidungen (ADRs)

- [Index & Vorlage](adr/README.md)

## Betrieb

- [Deployment & Betrieb](operations/deployment.md)
- [Backup, Restore, Upgrade](operations/backup.md)

## Prozess

- [Definition of Done](process/definition-of-done.md)
- [Aufgaben des Roadmap-Agenten](process/roadmap-agent.md)

## Tests

- [Testmatrix](testing/test-matrix.md)
- [Lasttests: Skripte, Ergebnisse, Grenzen](testing/load-tests.md)
- [Contract-Tests: HTTP-API als Black-Box gegen beliebige Server](testing/contract-tests.md)

Gesamtplanung: [`../ROADMAP.md`](../ROADMAP.md)
