# Contract-Tests (HTTP-Black-Box)

Das Paket `packages/contract-tests` (`@notion-alt/contract-tests`, Issue [#118](https://github.com/mszkb/notion-alternative/issues/118)) prüft die HTTP-API eines laufenden Servers nur über `fetch`: Pfade, Statuscodes, Cookies, Header, Fehlerobjekte `{error:{code,message,…}}` und das Sync-Protokoll ([ADR 0002](../adr/0002-sync-protocol.md)). Es kennt keine Interna (keine Datenbank, kein `app.inject`). Damit lässt sich derselbe Vertrag gegen den Node-Server und später gegen den PHP-Server (`apps/server-php`, [ADR 0018](../adr/0018-php-backend.md)) prüfen. Die Unit-Tests in `apps/server/test` bleiben unverändert bestehen.

## Ausführen

```sh
# Node-Server wird automatisch gestartet (temporäres Datenverzeichnis, freier Port)
pnpm --filter @notion-alt/contract-tests test

# einzelne Datei
pnpm --filter @notion-alt/contract-tests exec vitest run test/sync-push.test.ts

# anderer Server, z. B. PHP (läuft im Repo-Wurzelverzeichnis, Port als $PORT bzw. {port})
SERVER_CMD='php -d curl.cainfo=$PUSH_RECEIVER_CA -S 127.0.0.1:$PORT -t apps/server-php/public apps/server-php/public/index.php' pnpm --filter @notion-alt/contract-tests test

# bereits laufender Server (wird weder gestartet noch beendet)
SERVER_URL=http://127.0.0.1:3000 pnpm --filter @notion-alt/contract-tests test
```

- `pnpm test` im Wurzelverzeichnis führt die Contract-Tests **nicht** aus (`--filter '!@notion-alt/contract-tests'`); die GitHub-CI bleibt bei Unit-Tests. `pnpm typecheck` prüft das Paket mit.
- `CONTRACT_SERVER_LOG=1` gibt die Ausgabe des gestarteten Servers mit aus; bricht der Start ab, steht sie ohnehin in der Fehlermeldung.
- Playwright (`apps/web/playwright.config.ts`) startet mit gesetztem `SERVER_CMD` ebenfalls diesen Befehl statt des Node-Servers (Port `3100` als `PORT`/`{port}`, Arbeitsverzeichnis: Repo-Wurzel).

### Ablauf

`src/global-setup.ts` (Vitest `globalSetup`) startet vor dem Lauf:

1. einen **Fake-Push-Dienst** (`src/push-receiver.ts`): HTTPS auf `127.0.0.1` mit freiem Port und dem selbstsignierten Zertifikat `fixtures/push-receiver.crt` (gültig bis 2126, nur für Tests). `POST /send/<key>` antwortet `201`, `POST /gone/<key>` antwortet `410`. Die Tests lesen die Zustellungen über einen zweiten, unverschlüsselten Port.
2. ohne `SERVER_URL` den **Server** (`src/server.ts`): `SERVER_CMD` (Standard: `pnpm --filter @notion-alt/server exec tsx src/index.ts`) über die Shell im Repo-Wurzelverzeichnis, als eigene Prozessgruppe. Der Befehl bekommt die Umgebung unten, `{port}` im Befehl wird durch den Port ersetzt. Der Start gilt als fertig, sobald `GET /api/ready` mit `200` antwortet (höchstens 60 s). Nach dem Lauf werden Prozessgruppe (SIGTERM, nach 5 s SIGKILL) und Datenverzeichnis entfernt.

### Umgebung des Servers

Ein gestarteter Server bekommt genau diese Variablen. Ein externer Server (`SERVER_URL`) muss mit denselben Werten laufen. Die mit „überschreibbar“ markierten Werte lassen sich über die gleichnamige Variable ändern; die Tests rechnen dann mit dem neuen Wert.

| Variable | Wert | Zweck |
| --- | --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, freier Port | nur beim Start durch die Suite |
| `DATA_DIR`, `DATABASE_PATH` | temporäres Verzeichnis, `…/app.sqlite` | frische Datenbank pro Lauf |
| `LOG_LEVEL` | `warn` | |
| `ALLOW_REGISTRATION` | `true` | jeder Test legt eigene Konten an |
| `METRICS_ENABLED` | `true` | `GET /api/metrics`; antwortet der Server `404`, wird der Test übersprungen (Metriken sind laut ADR 0018 optional) |
| `LOGIN_MAX_FAILURES_PER_EMAIL` | `3` (überschreibbar) | Rate-Limit-Tests |
| `LOGIN_MAX_FAILURES_PER_IP` | `6` (überschreibbar) | Rate-Limit-Tests |
| `REGISTER_MAX_ATTEMPTS_PER_IP` | `4` (überschreibbar) | Rate-Limit-Tests |
| `ATTACHMENT_MAX_MB` | `1` (überschreibbar) | `too_large`, `413` beim Upload |
| `WORKSPACE_STORAGE_MB` | `0.003` (= 3 000 Byte, überschreibbar) | `quota_exceeded`, `storage_limit` beim Import |
| `PUSH_ALLOWED_HOSTS` | `127.0.0.1` | Fake-Push-Dienst |
| `NODE_EXTRA_CA_CERTS` | Pfad zu `fixtures/push-receiver.crt` | Node vertraut dem Fake-Push-Dienst |
| `PUSH_RECEIVER_CA` | derselbe Pfad | für andere Server, z. B. `php -d curl.cainfo=$PUSH_RECEIVER_CA …` |

Weitere Annahmen über den Server:

- **Client-Adresse:** Der Server übernimmt die Adresse aus dem letzten Eintrag von `X-Forwarded-For`, wenn die Verbindung von einer privaten Adresse kommt (Loopback, 10/8, 172.16/12, 192.168/16, fc00::/7), genau ein Proxy-Hop wie beim Node-Server. Jeder Test-Client schickt eine zufällige Adresse `10.x.y.z`; so hat jeder Test eigene Rate-Limits pro IP. Ein externer Server hinter einem weiteren Proxy (z. B. nginx im Compose-Stack) erfüllt das nicht: dort direkt das Backend ansprechen.
- **Push-Hinweise** dürfen asynchron und gebündelt verschickt werden; die Tests warten bis zu 15 s auf eine Zustellung und 4 s, bevor sie „keine Zustellung“ feststellen. Der Server muss den Fake-Push-Dienst per HTTPS mit dem Zertifikat oben erreichen.
- **IDs sind pro Server eindeutig** (nicht pro Konto): Importe in denselben Server laufen deshalb als Kopie mit neuen IDs (`remapExportIds`), auch die Fixtures. So bleibt die Suite gegen denselben externen Server wiederholbar.
- `MAX_SUBSCRIPTIONS_PER_USER` ist 20 (fest im Code).

## Testdaten

Nur über die API. Jeder Test registriert ein frisches Konto mit eindeutiger E-Mail (`<name>-<uuid>@example.com`) und eigener Client-Adresse (`signUp()` in `src/client.ts`); Tests teilen keine Daten und laufen parallel gegen denselben Server. Wo die Server-Tests Interna nutzen (`applyOperation`, `insertDevice`, direkte Datenbankabfragen), prüfen die Contract-Tests das Verhalten über `POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/sync/snapshot` und `GET /api/sync/log`. Ein zweites Gerät desselben Kontos ist ein weiteres `POST /api/devices` mit derselben Sitzung.

## Abdeckung

| Datei | Endpunkte |
| --- | --- |
| `health.test.ts` | `GET /api/health`, `GET /api/ready`, `GET /api/metrics`, unbekannte Route (`404 not_found`), kaputtes JSON (`400`) |
| `auth.test.ts` | `GET /api/auth/status`, `POST /api/auth/register` (`email_taken`, `invalid_input` mit `issues`, `registration_closed`), `POST /api/auth/login` (`invalid_credentials`, gleiche Antwort für unbekannte Konten), `POST /api/auth/logout`, `GET /api/auth/me`, Cookie-Attribute, Rate-Limits pro E-Mail/IP/Registrierung (`429 too_many_attempts`, `Retry-After`) |
| `password-change.test.ts` | `POST /api/auth/password` (`invalid_current_password`, Richtlinie, andere Sitzungen enden, zählt zum Login-Limit) |
| `workspaces.test.ts` | `GET/POST /api/workspaces`, `GET /api/workspaces/:id` |
| `devices.test.ts` | `POST/GET /api/devices`, `PATCH/DELETE /api/devices/:id` (`device_conflict`, `current_device`, `device_revoked`, #46), Logout mit `removeDevice` |
| `sync-push.test.ts`, `sync-apply.test.ts` | `POST /api/sync/push`: `applied`, `duplicate`, `rejected` (`workspace_not_found`, `not_found`, `device_not_active`, `op_id_reused`, `invalid_payload`, `already_exists`, `deleted`), Savepoint pro Operation (#95), Revisionen/`seq`, Tags, Wiederherstellen (#66), Batch-Grenzen |
| `sync-conflicts.test.ts` | `merged`, `conflict` (`changed`), Konfliktobjekt in Snapshot und Log, Auflösung |
| `sync-apply.test.ts` | `conflict` mit `deleted` und `parent_deleted` (T-DEL-02) |
| `sync-pull.test.ts` | `GET /api/sync/pull` (Paging, `cursor_ahead`, `cursor_expired`), `GET /api/sync/log` (auch nach „Kompaktierung“) |
| `sync-snapshot.test.ts` | `GET /api/sync/snapshot` ganz und seitenweise (#97): fester Cursor, Tabellengrenzen, Fortsetzen innerhalb einer Tabelle, Änderungen zwischen Seiten, ungültige Tokens |
| `search.test.ts` | `GET /api/search` (Normalisierung, Präfixe, Umlaute, Löschungen, FTS-Syntax als Text, fremde Workspaces) |
| `history.test.ts` | `GET /api/documents/:id/history`, `GET /api/documents/:id/history/:seq` |
| `attachments.test.ts` | `GET /api/attachments/usage`, `PUT/GET /api/attachments/:id/content` (`size_mismatch`, `checksum_mismatch`, `not_uploaded`, `deleted`, `415`, `413`, Header gegen XSS), Speicherlimits (#64) |
| `import.test.ts` | `POST /api/import` (`ids_exist`, `invalid_import`, `invalid_input`, `413 storage_limit`) |
| `export-roundtrip.test.ts` | T-EXP-02: reicher Workspace → ZIP → Import → Entitäten, Log, Anhang-Bytes und Markdown gleich; alle Fixtures in `apps/server/test/fixtures/exports/` |
| `push.test.ts` | `GET /api/push/public-key`, `POST/DELETE /api/push/subscriptions` (`device_not_registered`, `endpoint_not_allowed`, `invalid_keys`, `endpoint_taken`, `too_many_subscriptions`), Hinweis ohne Inhalte nur an andere Geräte, `410` entfernt die Subscription |

Ohne Fehlerfall bleiben `GET /api/health`, `GET /api/auth/status` und `GET /api/metrics` (kein Fehler möglich) sowie `GET /api/ready` (`503` nur bei kaputter Datenbank).

`cursor_expired`: Es gibt keine API für die Log-Kompaktierung. Ein importierter Workspace gilt aber bis zu seiner importierten Historie als kompaktiert (`compacted_seq` = Anzahl Änderungen, mindestens 1); darüber testen die Contract-Tests `410 cursor_expired`, die Nummerierung danach und `/api/sync/log` mit `compactedSeq`.

### Nur in `apps/server/test` (brauchen Interna oder Serverzeit)

- Kompaktierung eines Teils des Logs (`compactChangeLog`), abgelaufene Sitzungen, Ablauf des Rate-Limit-Fensters (`AttemptLimiter`), Löschen von Anhängen nach der Aufbewahrungsfrist (`purgeDeletedAttachments`), Zeitlücke zwischen Versionen (ADR 0013).
- Fehler mitten im Batch (Trigger, `500`) und atomares Schreiben von Entität und Änderung, Zyklen in bereits kaputten Daten, Suchindex nach Absturz (`search_dirty`, `reindexMarked`), `429 import_running` (Nebenläufigkeit).
- `isPrivateAddress` mit öffentlichen Proxy-Adressen, Bündelung „ein Hinweis pro Burst“ (Node-Timer), Abbruch nach fünf Fehlversuchen beim Push-Versand, kaputte gespeicherte Push-Schlüssel.
- Migrationen, Backup/Restore, Konfiguration, Metrik-Registry, S3 (`s3.integration.test.ts`).

## Wiederverwendbare Fixtures

Für den PHP-Server (PHPUnit) und andere Implementierungen:

| Fixture | Ort | Inhalt |
| --- | --- | --- |
| Export-ZIPs | `apps/server/test/fixtures/exports/v<schema_version>.zip` | ein vollständiger Export pro veröffentlichter Schemaversion; nie ändern ([README](../../apps/server/test/fixtures/exports/README.md)) |
| JSON Schema des Exports | `docs/architecture/export.schema.json` | Format von `workspace.json` |
| RFC-8291-Testvektor | `apps/server/test/push-crypto.test.ts` (`RFC`) | Schlüssel, Salt, Klartext und erwarteter Body aus RFC 8291, Anhang A; dort auch die VAPID-Prüfung (ES256-JWT, RFC 8292) |
| Push entschlüsseln | `packages/contract-tests/src/push-crypto.ts` | Gegenstück des User Agents (RFC 8291), prüft gesendete Hinweise |
| SigV4-Testvektor | `apps/server/test/s3-sign.test.ts` | „GET Object“-Beispiel aus der AWS-S3-Dokumentation mit erwarteter Signatur |
| Zertifikat des Fake-Push-Dienstes | `packages/contract-tests/fixtures/push-receiver.{crt,key}` | selbstsigniert für `127.0.0.1`/`localhost`, nur für Tests |

## Neue Tests

- Daten nur über die API anlegen, immer mit `signUp()` ein eigenes Konto; feste IDs nie wiederverwenden (sie sind pro Server eindeutig).
- Werte, die vom Server abhängen, aus `LIMITS`/`SERVER_SETTINGS` (`src/config.ts`) nehmen und neue nötige Variablen dort und in der Tabelle oben ergänzen.
- Was nur mit einem eigens gestarteten Server geht (z. B. `ALLOW_REGISTRATION=false`), mit `it.skipIf(!managedServer())` absichern und `startServer({...})` nutzen.
