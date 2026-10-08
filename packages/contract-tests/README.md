# Contract-Tests

Black-Box-Tests des HTTP-API ([#118](https://github.com/mszkb/notion-alternative/issues/118), [ADR 0018](../../docs/adr/0018-php-backend.md)). Sie sprechen nur HTTP (`fetch`) und legen alle Daten über das API an, damit sie gegen jede Server-Implementierung laufen: heute den Node-Server, später den PHP-Server.

```sh
pnpm --filter @notion-alt/contract-tests test                  # startet den Node-Server selbst
SERVER_CMD="php -S 127.0.0.1:\$PORT -t apps/server-php/public" \
  pnpm --filter @notion-alt/contract-tests test                # anderer Server, gleicher Ablauf
SERVER_URL=http://127.0.0.1:3000 pnpm --filter @notion-alt/contract-tests test   # laufender Server
```

`SERVER_CMD` läuft im Wurzelverzeichnis des Repos und bekommt `PORT`, `HOST`, `DATA_DIR`, `DATABASE_PATH`, `ATTACHMENTS_DIR` und die Testeinstellungen aus `src/server.ts` als Umgebung. Ein laufender Server unter `SERVER_URL` braucht dieselben Einstellungen (offene Registrierung, hohe Limits pro IP, `ATTACHMENT_MAX_MB=1`, `PUSH_ALLOWED_HOSTS=push.example.com`).

Abgedeckt (je Erfolgs- und Fehlerfall): Health, Auth und Passwort, Workspaces, Geräte, Sync-Push (applied, duplicate, op_id_reused, invalid_payload, not_found, already_exists, workspace_not_found, merged, conflict changed/deleted/parent_deleted, device_not_active), Pull (Seiten, cursor_ahead), Änderungslog, Snapshot (Paging über Tabellengrenzen, `content=false`, Einzelseite), Suche, Verlauf, Import, Anhänge, Web Push, Metriken.

Noch nicht über HTTP prüfbar: `cursor_expired` (braucht eine Kompaktierung des Änderungslogs, die das API nicht auslöst; geprüft in `apps/server/test/sync-snapshot.test.ts`), Rate-Limits mit Zeitfenster, Restore. Wiederverwendbare Fixtures: Exporte `apps/server/test/fixtures/exports/v*.zip`, Push-Testvektoren (RFC 8291) in `apps/server/test/push-crypto.test.ts`, SigV4 in `apps/server/test/s3-sign.test.ts`.

Playwright startet mit `SERVER_CMD` ebenfalls einen anderen Server (`apps/web/playwright.config.ts`).
