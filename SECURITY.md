# Security Policy

## Sicherheitslücken melden

Bitte **keine öffentlichen Issues** für Sicherheitslücken. Stattdessen über GitHub melden: Repository → **Security** → **Report a vulnerability** (private Security Advisory).

Hilfreich sind: betroffene Version/Commit, Schritte zum Nachvollziehen, erwartete Auswirkung. Wir bestätigen den Eingang in der Regel innerhalb einer Woche und stimmen Veröffentlichung und Fix mit dir ab.

## Unterstützte Versionen

Das Projekt ist vor der ersten stabilen Version; Fixes landen auf dem Hauptzweig.

## Hinweise für Betreiber

- Referenz-Deployment: App nur auf `127.0.0.1`, Zugriff per SSH-Tunnel ([ADR 0010](docs/adr/0010-reference-deployment-and-https.md)). Hinter einem TLS-Proxy `COOKIE_SECURE=true` setzen.
- Registrierung ist nach dem ersten Konto geschlossen (`ALLOW_REGISTRATION=false`).
- Backups enthalten alle Inhalte, Konten, Sitzungen und den VAPID-Schlüssel: wie Zugangsdaten schützen ([Backup](docs/operations/deployment.md)).
- Ergebnisse des letzten Reviews: [docs/security/review-2026-10.md](docs/security/review-2026-10.md).
