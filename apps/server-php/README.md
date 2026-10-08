# PHP-Server (Slim 4)

Das Backend in PHP für Shared Hosting und Docker ([ADR 0018](../../docs/adr/0018-php-backend.md), Epic [#116](https://github.com/mszkb/notion-alternative/issues/116)). Es hat den Node-Server (`apps/server`, Fastify) abgelöst ([#129](https://github.com/mszkb/notion-alternative/issues/129)) und übernimmt dessen HTTP-API bis aufs Byte, SQLite-Datei, Migrationen und Ablage der Anhänge. Die Spezifikation sind die Contract-Tests ([`docs/testing/contract-tests.md`](../../docs/testing/contract-tests.md)). Verweise auf `apps/server/…` unten meinen den Node-Server im Stand vor seiner Entfernung (Git-Historie, z. B. Commit `886e471`).

## Voraussetzungen

- PHP **≥ 8.2**
- Extensions: `pdo_sqlite` (SQLite **mit FTS5**), `mbstring`, `json`
- Für Web Push: `openssl` und `curl`; für Anhänge in S3 (`ATTACHMENT_STORAGE=s3`): `curl`
- Composer (nur für die Entwicklung; das Release-ZIP enthält `vendor/`, siehe #128)

FTS5 wird beim ersten Datenbankzugriff geprüft. Fehlt es, antwortet `/api/ready` mit 503 und im Log steht `SQLite of this PHP installation has no FTS5 …`.

## Lokal starten

```sh
cd apps/server-php
composer install
DATABASE_PATH=/tmp/notion-alt/app.sqlite php -S 127.0.0.1:8000 -t public public/index.php
curl http://127.0.0.1:8000/api/health   # {"status":"ok"}
curl http://127.0.0.1:8000/api/ready    # {"status":"ok","checks":{"database":"ok"}}
```

`public/index.php` ist Front-Controller und Router-Skript des eingebauten Servers: Alle Anfragen (auch Pfade mit Punkt, z. B. `/api/attachments/x.png`) gehen an Slim. Die Datenbank wird beim ersten Zugriff angelegt und migriert; `/api/health` braucht keine Datenbank.

`pnpm dev` im Wurzelverzeichnis startet diesen Server auf `127.0.0.1:3000` (`php -S`) und Vite auf `:5173` mit Proxy für `/api`.

## Apache / Shared Hosting

`public/.htaccess` leitet jede Anfrage an `index.php` weiter (braucht `mod_rewrite` und `AllowOverride FileInfo` oder `All`). Nur `public/` gehört in den Webroot; `src/`, `vendor/`, `config.php` und die Daten liegen außerhalb.

Alle Routen beginnen mit `/api`. Liegt die App nicht im Wurzelverzeichnis des Hosts, wird der Teil vor `/api` automatisch aus `SCRIPT_NAME` abgeleitet und abgeschnitten:

| `index.php` erreichbar als | Anfragen an |
| --- | --- |
| `/index.php` (`public/` ist Webroot) | `/api/…` |
| `/api/index.php` (`public/` als Ordner `api/` im Webroot) | `/api/…` |
| `/notes/api/index.php` | `/notes/api/…` |
| `/notes/index.php` | `/notes/api/…` |

Das Paket für Shared Hosting (SPA + `api/` + `vendor/`) und das Docker-Image folgen in #128.

## Docker

`apps/server-php/Dockerfile` baut PHP-FPM (offizielles Image `php:8.3-fpm-bookworm`, auch `linux/arm64`) mit OPcache, `clear_env = no` (Konfiguration aus der Umgebung), `memory_limit = 512M` und einem Entrypoint, der migriert und `bin/cron.php` alle 5 Minuten startet. Der Healthcheck `bin/fpm-healthcheck.php` schickt eine FastCGI-Anfrage für `/api/health` an `127.0.0.1:9000`. Das Frontend (nginx) spricht mit `apps/web/nginx.php.conf` FastCGI mit dem Backend; `X-Forwarded-For` setzt nginx wie beim Proxy, damit die Rate-Limits die echte Client-Adresse sehen.

```sh
ALLOW_REGISTRATION=true docker compose up -d --build
```

Die App ist dann unter `http://127.0.0.1:8080` erreichbar. Ein Volume `data` der Node-Version wird weiterverwendet und migriert; Konten brauchen danach ein neues Passwort (`docker compose exec backend php bin/console reset-password <E-Mail>`, ADR 0018).

## Webhosting (Release-ZIP)

`scripts/build-php-release.sh [Version]` baut `dist/php-release/notion-alt-php-<Version>.zip`: die SPA im Wurzelverzeichnis mit `.htaccess` (SPA-Fallback, Sicherheits- und Cache-Header wie `apps/web/nginx.conf`), `api/index.php` als Front-Controller mit eigener `.htaccess`, `api/check.php` (Einrichtungs-Check im Browser) und `api/app/` mit Code, `vendor/`, `bin/` und `config.example.php` (per `.htaccess` gesperrt). Die Vorlagen liegen in `release/`. `SKIP_WEB_BUILD=1` nutzt ein vorhandenes `apps/web/dist`, `VENDOR_DIR=…` kopiert ein vorhandenes `vendor/` statt Composer aufzurufen. Anleitung für Nutzer: [`docs/user/webhosting.md`](../../docs/user/webhosting.md).

## Konfiguration

Dieselben Variablen, Defaults und Prüfungen wie der frühere Node-Server (`apps/server/src/config.ts`) (siehe [`docs/operations/deployment.md`](../../docs/operations/deployment.md)), ohne `HOST` und `PORT` (die bestimmt der Webserver). Leere Werte gelten als nicht gesetzt.

Quellen, die spätere gewinnt:

1. `config.php` – gibt ein Array zurück. Standardpfad: `apps/server-php/config.php` (neben `public/`, außerhalb des Webroots); ein anderer Pfad über die Umgebungsvariable `NOTION_ALT_CONFIG`. Ist `NOTION_ALT_CONFIG` gesetzt und die Datei fehlt, startet der Server nicht.
2. Umgebungsvariablen.

```php
<?php
// config.php – Werte als String, Zahl oder Boolean; PUSH_ALLOWED_HOSTS auch als Liste.
return [
    'DATA_DIR' => '/home/user/notion-data',
    'COOKIE_SECURE' => true,
    'ALLOW_REGISTRATION' => false,
];
```

Abweichung vom Node-Server: Relative Pfade (`DATA_DIR`, `DATABASE_PATH`, `ATTACHMENTS_DIR`) beziehen sich auf `apps/server-php/`, nicht auf das Arbeitsverzeichnis (das ist unter PHP nicht festgelegt). Der Default `./data` liegt damit in `apps/server-php/data/`.

Ungültige Werte führen zu einer Fehlermeldung, die nur Variablennamen nennt (z. B. `ATTACHMENT_STORAGE=s3 needs S3_BUCKET`), nie Werte. Jede Anfrage beantwortet der Server dann mit 500 `internal`.

## Verhalten wie der Node-Server

- **Fehlerformat** `{"error":{"code","message",…}}`: `HttpError` mit eigenem Status und Code, andere 4xx als `bad_request`, unbekannte Route **und falsche Methode** als 404 `not_found` (Fastify kennt kein 405), sonst 500 `internal` (mit Log-Eintrag).
- **Request-Bodys** wie Fastify: `application/json` (ungültig → 400, leer → 400, `__proto__`/`constructor.prototype` → 400), `text/plain` als String, andere Typen mit Body → 415, Limit 1 MiB → 413.
- **Validierung**: kleiner Port von zod in `src/Validation` (`V::object`, `V::string()->trim()->min()…`, `Validation::parseInput`), Fehler 400 `invalid_input` mit `issues[{path,message}]`. Die Schemas aus `packages/shared` werden mit den Endpunkten portiert (`src/Shared`); Pfade und Codes stimmen überein, Meldungstexte folgen zod.
- **Logs**: eine JSON-Zeile pro Ereignis im pino-Format (`level` numerisch, `time` in ms, `msg`) auf stderr bzw. `error_log()`. Pro Anfrage `request completed` mit Methode, Pfad **ohne Query-String**, Status und `responseTime`; `/api/health` und `/api/ready` erscheinen erst ab `warn`. `LOG_LEVEL` gilt.
- **SQLite**: Verzeichnis wird angelegt, `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Schreibende Transaktionen beginnen mit `begin immediate` (parallele Anfragen).
- **Sessions**: Cookie `session` (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Expires`, `Secure` nach `COOKIE_SECURE`), Token aus 32 Zufallsbytes (base64url), in der Datenbank nur der SHA-256-Hash; Laufzeit `SESSION_TTL_DAYS`. IDs sind UUID v4, Zeitstempel ISO 8601 mit Millisekunden wie `toISOString()`.
- **Client-Adresse** (Rate-Limits pro IP): wie `trustProxy` des Node-Servers. Kommt die Verbindung (`REMOTE_ADDR`) von einer privaten oder Loopback-Adresse, gilt der letzte Eintrag von `X-Forwarded-For`, sonst `REMOTE_ADDR`.

## Passwörter und Rate-Limits

- **Neue Hashes** mit `password_hash()`: Argon2id, falls PHP es kennt, sonst bcrypt.
- **Hashes des früheren Node-Servers** (scrypt) werden nicht übernommen (ADR 0018): Der Login schlägt fehl, `bin/console reset-password <E-Mail>` setzt ein neues Passwort.
- Für unbekannte E-Mail-Adressen wird gegen einen festen Dummy-Hash desselben Verfahrens geprüft, damit die Antwortzeit keine Konten verrät.
- **Rate-Limits** (`LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_MAX_FAILURES_PER_EMAIL`, `REGISTER_MAX_ATTEMPTS_PER_IP`, `AUTH_RATE_LIMIT_WINDOW_MINUTES`) wie beim Node-Server (festes Fenster pro Schlüssel, 429 `too_many_attempts` mit `retryAfter` und Header `Retry-After`). Da PHP zwischen Anfragen nichts im Speicher behält, liegen die Zähler in der Tabelle `auth_attempts`; abgelaufene Zeilen löscht jeder schreibende Zugriff.

## Migrationen

`src/Database/Migrations` enthält je eine Klasse pro Node-Migration (`0001_initial` … `0013_auth_attempts`) mit exakt der DDL, die Kysely erzeugt. `0013_auth_attempts` (Zähler der Rate-Limits) nutzt nur der PHP-Server; der Node-Server legt die Tabelle an, zählt aber im Speicher. Der Migrator nutzt Kyselys Tabellen `kysely_migration` und `kysely_migration_lock` (gleiche DDL, gleiches Zeitstempelformat): Eine vom Node-Server angelegte Datenbank wird erkannt und fortgeführt, eine neue bekommt dasselbe Schema. Unbekannte Migrationsnamen (z. B. von einer neueren Version) brechen wie bei Kysely ab.

Anders als Kysely unter SQLite (ein Prozess) laufen PHP-Anfragen parallel: Der Migrator setzt den Lock-Eintrag wirklich (`is_locked = 1`) und führt jede Migration samt Buchungszeile in einer eigenen Transaktion aus. Bleibt der Lock nach einem Absturz stehen, nennt die Fehlermeldung das SQL zum Freigeben.

**Neue Migration:** Klasse in `src/Database/Migrations` anlegen, in `Migrator::all()` eintragen, im `MigratorTest` die Liste `ALL` ergänzen und die neuen Tabellen und Indizes in `tests/fixtures/node-schema.json` nachtragen (erwartetes `sqlite_master` nach allen Migrationen). Bestehende Migrationen nie ändern (T-MIG-01).

Die Fixtures in `tests/fixtures/` sind eingefroren: `node-schema.json`, `node-0004.sqlite` und `node-latest.sqlite` hat der Node-Server bis Migration `0015_metrics` erzeugt (Datenbank mit Inhalt vor und nach seinen Migrationen 0005–0015), `inline-plaintext.json` sind die Erwartungswerte für den Port von `inlineToPlainText` (Migration 0005), `search.json` die Treffer der Node-Suche. Sie belegen, dass eine Datenbank der Node-Version weiterläuft.

## Dateianhänge

Port von `apps/server/src/attachments/` (ADR 0012), gleiche Ablage wie der Node-Server: `ATTACHMENTS_DIR/<workspace>/<id>` im Volume (atomar über Temp-Datei und `rename`) oder Objekt `<workspace>/<id>` im S3-Bucket (`src/Attachments/S3Client.php`, SigV4 mit `S3Signer`, Versand mit ext-curl, ohne Redirects, 60 s Timeout). Ein Wechsel zwischen den Servern braucht deshalb keine Migration der Dateien.

- `PUT /api/attachments/:id/content` nimmt nur `application/octet-stream` an (sonst 415). Für diese Route gilt `ATTACHMENT_MAX_MB` als Body-Limit statt 1 MiB (Routen-Argument `JsonBodyMiddleware::RAW_BODY_LIMIT`, wie `bodyLimit` einer Fastify-Route). Der Body wird ganz gelesen; `memory_limit` muss deshalb deutlich über `ATTACHMENT_MAX_MB` liegen (Default 25 MB, PHP-Default 128 MB reicht). `post_max_size` und `upload_max_filesize` gelten für `PUT` nicht.
- Größe und SHA-256 werden gegen die synchronisierten Metadaten geprüft; Quota (`WORKSPACE_STORAGE_MB`) und Dateigröße prüft schon der Sync-Push.
- `GET …/content` streamt die Datei; nur Rasterbilder inline, alles andere als Download, mit `nosniff`, `sandbox`-CSP und `no-store` (gleiche Header wie Node, `Content-Disposition` nach RFC 6266 bis auf das Zeichen gleich).
- `Purge::deletedAttachments` entfernt Dateien gelöschter Anhänge nach `ATTACHMENT_RETENTION_DAYS`; aufgerufen wird es vom Cron (#127).

## Web Push

Port von `apps/server/src/push/` (ADR 0005): Abos mit denselben Prüfungen und Fehlercodes (`device_not_registered`, `endpoint_not_allowed` nach `PUSH_ALLOWED_HOSTS`, `invalid_keys`, `endpoint_taken`, `too_many_subscriptions` ab 20 Abos), VAPID-Schlüssel und Installations-ID in `settings` (dieselben Zeilen wie Node, ein vorhandenes Schlüsselpaar gilt weiter). Der Hinweis enthält nur `{"type":"sync_available","installation","workspace"}`.

**Bündeln ohne Timer.** Node sammelt die Hinweise eines Bursts 2 s im Speicher. PHP hält zwischen Anfragen nichts, deshalb liegt pro Abo eine Zeile in `push_hints` (Migration `0014_push_hints`, in Node angelegt, aber ungenutzt):

- Nach einem Sync-Push mit angewandten, gemergten oder Konflikt-Operationen bekommt jedes andere Gerät des Owners einen fälligen Hinweis. Der erste nach einer Ruhepause ist sofort fällig, weitere innerhalb von 2 s nach dem letzten Versand werden zu einem Hinweis am Ende dieses Fensters gebündelt.
- **Versand nach der Antwort** (`Http/AfterResponse`): unter PHP-FPM nach `fastcgi_finish_request()`, sonst mit `Content-Length` und geleerter Ausgabe, damit der Client nicht wartet. Fällige Hinweise gehen sofort raus; einen gebündelten Hinweis wartet der Prozess nur unter PHP-FPM ab (höchstens 2 s). Sonst schickt ihn der nächste Sync-Push oder -Pull eines Geräts oder der Cron (#127).
- Jeder Hinweis wird vor dem Versand per `update … where due_at = ?` beansprucht, parallele Worker senden ihn also nie doppelt. `404`/`410` des Push-Dienstes löschen das Abo, ebenso fünf Fehlversuche in Folge.
- Versand mit ext-curl (nur HTTPS, keine Redirects, 10 s Timeout). Für die Contract-Tests muss `curl` dem Zertifikat des Fake-Push-Dienstes vertrauen: `php -d curl.cainfo=$PUSH_RECEIVER_CA -S …`.

## Cron und Kommandozeile

Was der Node-Server mit Timern erledigt, macht `bin/cron.php`. Beim Hoster alle 5 Minuten eintragen:

```sh
*/5 * * * * php /pfad/zu/api/bin/cron.php
```

Ein Lauf löscht abgelaufene Sitzungen und Rate-Limit-Zähler, baut veraltete Sucheinträge neu (#99), verschickt fällige Push-Hinweise und entfernt Dateien gelöschter Anhänge nach `ATTACHMENT_RETENTION_DAYS`. Er schreibt eine JSON-Zeile ins Log; überlappende Läufe überspringt eine `flock`-Sperre (`cron.lock` neben der Datenbank). Fehlt der Cron, holen Anfragen das Nötige nach (Suchindex vor jeder Suche, Push-Hinweise nach Sync-Anfragen); nur das Aufräumen bleibt dann liegen.

`bin/console` (gleiche Konfiguration wie der Webserver; Ausgabe eine JSON-Zeile, Fehler auf stderr):

| Befehl | Zweck |
| --- | --- |
| `migrate` | ausstehende Migrationen anwenden (sonst macht das die erste Anfrage) |
| `backup [Zielordner]` | Datenbank (`VACUUM INTO`, konsistent im laufenden Betrieb) und Anhänge des Volumes nach `backup-<Zeit>/` mit `manifest.json`; Standardziel `<Datenverzeichnis>/backups` |
| `restore <Backup-Ordner> [--force]` | Backup prüfen und zurückspielen, danach migrieren und die Sequenznummern anheben (alle Geräte synchronisieren neu). Vorher die App vom Netz nehmen; `--force` ersetzt eine vorhandene Datenbank |
| `migrate-attachments-to-s3` | Anhänge aus dem Volume nach S3 kopieren und prüfen (#63), wiederholbar |
| `reset-password <E-Mail>` | neues Passwort setzen und alle Sitzungen beenden. Das Passwort kommt von stdin (`echo '…' \| bin/console reset-password a@b.de`); im Terminal ohne Eingabe wird eines erzeugt und ausgegeben. Für Konten aus der Node-Zeit, deren scrypt-Hashes nicht übernommen werden (ADR 0018) |

Backups haben dasselbe Format wie beim Node-Server (`manifest.json`, `app.sqlite`, `attachments/<workspace>/<id>`); ein Backup des einen lässt sich mit dem anderen zurückspielen, solange dieser alle Migrationen kennt.

## Metriken

Mit `METRICS_ENABLED=true` gibt es `GET /api/metrics` (im Docker-Stack nur über `php bin/console metrics`, weil das Backend FastCGI spricht) im Prometheus-Textformat wie beim Node-Server (ohne `true` antwortet die Route mit 404). Da PHP zwischen Anfragen keine Zähler hält, liegen die Serien in der Tabelle `metrics` (Migration `0015_metrics`, in Node angelegt, aber ungenutzt). Jede Anfrage wird nach der Antwort gezählt (`http_requests_total`, `http_request_duration_seconds` mit Routen-Vorlage wie `/api/workspaces/:id`, nie dem konkreten Pfad), dazu `sync_push_operations_total` und `sqlite_file_size_bytes`. Die Prozess- und Event-Loop-Werte von Node (`process_*`, `nodejs_eventloop_lag_seconds`) gibt es unter PHP nicht. Das kostet pro Anfrage einen kleinen Schreibzugriff; ohne `METRICS_ENABLED` entfällt er.

## Verlauf, Import und Export

- **Verlauf** (`src/History`, ADR 0013): Port von `apps/server/src/history/`. Versionen sind Bearbeitungssitzungen pro Gerät (Abstand höchstens 10 Minuten), neueste zuerst, höchstens 200. Ein Stand wird aus dem Änderungslog der Seite und ihrer Blöcke zurückgerechnet; Blöcke nach Sortierschlüssel und ID.
- **Import** (`src/Import`, ADR 0004): `POST /api/import` legt aus einem JSON-Export (nur die aktuelle `schema_version`; ältere hebt der Client an) einen neuen Workspace an, in einer Transaktion: Entitäten mit IDs und Revisionen, Verlauf als Änderungslog, Suchindex. Prüfungen wie in Node: Referenzen und Baumstruktur (`400 invalid_import`), Speicherlimit (`413 storage_limit`), vorhandene IDs (`409 ids_exist`). Body-Limit `IMPORT_MAX_MB` (Routen-Argument `JsonBodyMiddleware::BODY_LIMIT`). Der Export wird als Ganzes dekodiert und geprüft; `memory_limit` sollte bei großen Importen etwa das Zehnfache der Exportgröße erlauben.
- **Sperre:** Der Node-Server erlaubt einen Import zur Zeit (Flag im Speicher). PHP hat keinen gemeinsamen Speicher zwischen den Workern, deshalb hält der Import ein exklusives, nicht blockierendes `flock` auf `import.lock` neben der Datenbank; ist es belegt, antwortet der Server mit `429 import_running`. Das Betriebssystem gibt die Sperre am Ende der Anfrage frei, auch nach einem Absturz (ADR 0018 sah eine Zeile mit Ablaufzeit vor; `flock` braucht keinen Ablauf). Auf Netzlaufwerken ohne `flock`-Unterstützung (manche NFS-Mounts) ist die Sperre wirkungslos.
- **Export:** braucht keine eigenen Endpunkte. Der Client baut ihn aus der lokalen Datenbank, `GET /api/sync/log` (Verlauf, auch nach Kompaktierung) und den Anhängen (`GET /api/attachments/:id/content`).

## Bausteine

Reine Funktionen ohne HTTP, für die späteren Endpunkte vorab portiert; nur `ext-openssl` und `hash`:

- `src/Push` (Web Push, #125): `WebPushCrypto::encrypt` (RFC 8291, aes128gcm), `Vapid::authorization` (RFC 8292, ES256-JWT), `VapidKeys` (liest und schreibt das JSON, das der Node-Server in `settings` unter `vapid` speichert; ein vorhandenes Schlüsselpaar gilt weiter), `PushRequest::syncAvailable` (Header und verschlüsselter Hinweis ohne Inhalte) und `PushRequest::isAllowedEndpoint`. Tests: RFC-8291-Testvektor, JWT-Prüfung mit dem öffentlichen Schlüssel, Node-Schlüssel laden.
- `src/Attachments/S3Signer.php` (S3, #124): AWS Signature V4 mit Header und Objekt-URLs (Path-Style oder virtueller Host). Tests: AWS-Beispiel und vom Node-Client aufgezeichnete Anfragen. Presigned URLs gibt es wie im Node-Server nicht. Genutzt von `S3Client` (siehe Dateianhänge).
- `src/Sync` (Sync-Push, #121): Port von `apps/server/src/sync/apply.ts` (`Apply::batch`: eine Transaktion je Batch, ein Savepoint je Operation; Revisionen, Tombstones, Block-Merge und Konfliktobjekte nach ADR 0003, Einträge in `changes`, Markierung für den Suchindex), `Mapping` (Port von `mapping.ts`) und `SyncRoutes` (`POST /api/sync/push`). Payloads bleiben `stdClass`, damit `{}` wie in Node als `{}` gespeichert wird. Die Eingabeschemas stehen in `src/Shared/SyncSchemas.php`. Nach dem Batch plant `PushRoutes::afterChanges` die Hinweise an die anderen Geräte (siehe Web Push). Tests: `tests/Unit/SyncApplyTest.php`.
- `src/Search/SearchIndex.php` (Suche, #123): Port von `apps/server/src/search/index.ts` mit PDO – `reindexDocument` (Zeile über die Rowid aus `search_documents`), `markForReindex`/`reindexMarked` (`search_dirty`), `toFtsQuery` und `searchWorkspace` (nur Workspaces des Owners, gleiche Treffer, Reihenfolge und Snippets wie Node). Die Route `GET /api/search` liegt in `SearchRoutes`, ihr Eingabeschema in `src/Shared/SearchSchemas.php`. Tests: Fälle aus `search.test.ts`/`migrations.test.ts` und `tests/fixtures/search.json` (Treffer des Node-Servers, eingefroren).

## Tests und Werkzeuge

| Befehl | Zweck |
| --- | --- |
| `composer test` | PHPUnit (`tests/`) |
| `composer analyse` | PHPStan, **Level max** (`phpstan.neon.dist`) |
| `composer cs` / `composer cs:fix` | PHP-CS-Fixer (PER-CS 2.0, `declare(strict_types=1)`) prüfen / korrigieren |

PHPStan läuft auf Level `max` (ADR 0018). Die CI (`.github/workflows/ci.yml`, Job `php`) führt alle drei auf PHP 8.2 und 8.3 aus.
