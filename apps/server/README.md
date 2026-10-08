# Server (PHP, Slim 4)

Das Backend für Webhosting und Docker ([ADR 0018](../../docs/adr/0018-php-backend.md)): HTTP-API unter `/api`, SQLite mit FTS5, Anhänge im Volume oder in S3, Web Push. Die Spezifikation des API sind die Contract-Tests ([`docs/testing/contract-tests.md`](../../docs/testing/contract-tests.md)); die Vue-SPA in `apps/web` ist der einzige Client.

## Voraussetzungen

- PHP **≥ 8.2**
- Extensions: `pdo_sqlite` (SQLite **mit FTS5**), `mbstring`, `json`, `openssl`, `sodium`, `curl` (Web Push, S3)
- Composer (nur für die Entwicklung; das Release-ZIP enthält `vendor/`)

FTS5 wird beim ersten Datenbankzugriff geprüft. Fehlt es, antwortet `/api/ready` mit 503 und im Log steht `SQLite of this PHP installation has no FTS5 …`.

## Lokal starten

```sh
cd apps/server
composer install
DATABASE_PATH=/tmp/notion-alt/app.sqlite php -S 127.0.0.1:8000 -t public public/index.php
curl http://127.0.0.1:8000/api/health   # {"status":"ok"}
curl http://127.0.0.1:8000/api/ready    # {"status":"ok","checks":{"database":"ok"}}
```

`public/index.php` ist Front-Controller und Router-Skript des eingebauten Servers: Alle Anfragen (auch Pfade mit Punkt, z. B. `/api/attachments/x.png`) gehen an Slim. Die Datenbank wird beim ersten Zugriff angelegt und migriert; `/api/health` braucht keine Datenbank.

`pnpm dev` im Wurzelverzeichnis startet diesen Server auf `127.0.0.1:3000` (`php -S`) und Vite auf `:5173` mit Proxy für `/api`.

## Betrieb

### Webhosting (Release-ZIP)

`scripts/build-php-release.sh [Version]` baut `dist/php-release/notion-alt-php-<Version>.zip`: die SPA im Wurzelverzeichnis mit `.htaccess` (SPA-Fallback, Sicherheits- und Cache-Header wie `apps/web/nginx.conf`), `api/index.php` als Front-Controller mit eigener `.htaccess`, `api/check.php` (Einrichtungs-Check im Browser) und `api/app/` mit Code, `vendor/`, `bin/` und `config.example.php` (per `.htaccess` gesperrt). Die Vorlagen liegen in `release/`. `SKIP_WEB_BUILD=1` nutzt ein vorhandenes `apps/web/dist`, `VENDOR_DIR=…` kopiert ein vorhandenes `vendor/` statt Composer aufzurufen. Anleitung für Nutzer: [`docs/user/webhosting.md`](../../docs/user/webhosting.md).

Alle Routen beginnen mit `/api`. Liegt die App nicht im Wurzelverzeichnis des Hosts, wird der Teil vor `/api` aus `SCRIPT_NAME` abgeleitet und abgeschnitten:

| `index.php` erreichbar als | Anfragen an |
| --- | --- |
| `/index.php` (`public/` ist Webroot) | `/api/…` |
| `/api/index.php` (`public/` als Ordner `api/` im Webroot, so im Release-ZIP) | `/api/…` |
| `/notes/api/index.php` | `/notes/api/…` |
| `/notes/index.php` | `/notes/api/…` |

Ohne Release-ZIP leitet `public/.htaccess` jede Anfrage an `index.php` weiter (braucht `mod_rewrite` und `AllowOverride FileInfo` oder `All`); dann gehört nur `public/` in den Webroot.

### Docker

`Dockerfile` baut PHP-FPM (offizielles Image `php:8.3-fpm-bookworm`, auch `linux/arm64`) mit OPcache, `clear_env = no` (Konfiguration aus der Umgebung) und `memory_limit = 512M`. Der Entrypoint migriert für `php-fpm` die Datenbank und startet `bin/cron.php` alle 5 Minuten; andere Befehle (z. B. `php bin/console restore …`) laufen unverändert. Der Healthcheck `bin/fpm-healthcheck.php` schickt eine FastCGI-Anfrage für `/api/health` an `127.0.0.1:9000`. Das Frontend (nginx, `apps/web/nginx.conf`) spricht FastCGI mit dem Backend und setzt `X-Forwarded-For`, damit die Rate-Limits die echte Client-Adresse sehen.

```sh
ALLOW_REGISTRATION=true docker compose up -d --build
```

Die App ist dann unter `http://127.0.0.1:8080` erreichbar; Details in [`docs/operations/deployment.md`](../../docs/operations/deployment.md).

## Konfiguration

Variablen und Defaults: [`docs/operations/deployment.md`](../../docs/operations/deployment.md). `HOST` und `PORT` gibt es nicht, die bestimmt der Webserver. Leere Werte gelten als nicht gesetzt.

Quellen, die spätere gewinnt:

1. `config.php` – gibt ein Array zurück. Standardpfad: `apps/server/config.php` (neben `public/`, außerhalb des Webroots); ein anderer Pfad über die Umgebungsvariable `NOTION_ALT_CONFIG`. Ist `NOTION_ALT_CONFIG` gesetzt und die Datei fehlt, startet der Server nicht.
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

Relative Pfade (`DATA_DIR`, `DATABASE_PATH`, `ATTACHMENTS_DIR`) beziehen sich auf `apps/server/`, nicht auf das Arbeitsverzeichnis (das ist unter PHP nicht festgelegt). Der Default `./data` liegt damit in `apps/server/data/`.

Ungültige Werte führen zu einer Fehlermeldung, die nur Variablennamen nennt (z. B. `ATTACHMENT_STORAGE=s3 needs S3_BUCKET`), nie Werte. Jede Anfrage beantwortet der Server dann mit 500 `internal`.

## Verhalten des API

- **Fehlerformat** `{"error":{"code","message",…}}`: `HttpError` mit eigenem Status und Code, andere 4xx als `bad_request`, unbekannte Route **und falsche Methode** als 404 `not_found` (kein 405), sonst 500 `internal` (mit Log-Eintrag).
- **Request-Bodys:** `application/json` (ungültig → 400, leer → 400, `__proto__`/`constructor.prototype` → 400), `text/plain` als String, andere Typen mit Body → 415, Limit 1 MiB → 413. Routen können ein eigenes Limit (`JsonBodyMiddleware::BODY_LIMIT`) setzen und `application/octet-stream` annehmen (`OCTET_STREAM`).
- **Validierung:** kleiner Nachbau von zod in `src/Validation` (`V::object`, `V::string()->trim()->min()…`, `Validation::parseInput`), Fehler 400 `invalid_input` mit `issues[{path,message}]`. Die Schemas in `src/Shared` entsprechen den zod-Schemas in `packages/shared`, die der Client nutzt; Pfade und Codes stimmen überein, Meldungstexte folgen zod.
- **Logs:** eine JSON-Zeile pro Ereignis im pino-Format (`level` numerisch, `time` in ms, `msg`) auf stderr bzw. `error_log()`. Pro Anfrage `request completed` mit Methode, Pfad **ohne Query-String**, Status und `responseTime`; `/api/health` und `/api/ready` erscheinen erst ab `warn`. `LOG_LEVEL` gilt.
- **SQLite:** Verzeichnis wird angelegt, `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Schreibende Transaktionen beginnen mit `begin immediate` (parallele Anfragen).
- **Sessions:** Cookie `session` (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Expires`, `Secure` nach `COOKIE_SECURE`), Token aus 32 Zufallsbytes (base64url), in der Datenbank nur der SHA-256-Hash; Laufzeit `SESSION_TTL_DAYS`. IDs sind UUID v4, Zeitstempel ISO 8601 mit Millisekunden.
- **Client-Adresse** (Rate-Limits pro IP): Kommt die Verbindung (`REMOTE_ADDR`) von einer privaten oder Loopback-Adresse, gilt der letzte Eintrag von `X-Forwarded-For` (genau ein Proxy), sonst `REMOTE_ADDR`.
- **Arbeit nach der Antwort** (`Http/AfterResponse`: Push-Hinweise, Metriken): unter PHP-FPM nach `fastcgi_finish_request()`, sonst mit `Content-Length` und geleerter Ausgabe, damit der Client nicht wartet.

## Passwörter und Rate-Limits

- Hashes mit `password_hash()`: Argon2id, falls PHP es kennt, sonst bcrypt; ältere Parameter werden beim Login angehoben. Andere Formate (z. B. scrypt aus der Zeit vor ADR 0018) werden nicht geprüft: Der Login schlägt fehl, `bin/console reset-password <E-Mail>` setzt ein neues Passwort.
- Für unbekannte E-Mail-Adressen wird gegen einen festen Dummy-Hash desselben Verfahrens geprüft, damit die Antwortzeit keine Konten verrät.
- **Rate-Limits** (`LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_MAX_FAILURES_PER_EMAIL`, `REGISTER_MAX_ATTEMPTS_PER_IP`, `AUTH_RATE_LIMIT_WINDOW_MINUTES`): festes Fenster pro Schlüssel, 429 `too_many_attempts` mit `retryAfter` und Header `Retry-After`. Da PHP zwischen Anfragen nichts im Speicher behält, liegen die Zähler in der Tabelle `auth_attempts`; abgelaufene Zeilen löscht jeder schreibende Zugriff und der Cron.

## Migrationen

`src/Database/Migrations` enthält eine Klasse pro Migration (`0001_initial` …). Die Buchführung liegt in den Tabellen `kysely_migration` und `kysely_migration_lock`; die Namen stammen vom früheren Node-Server und bleiben, damit vorhandene Datenbanken weiterlaufen. Unbekannte Migrationsnamen (z. B. von einer neueren Version) brechen ab.

PHP-Anfragen laufen parallel: Der Migrator setzt den Lock-Eintrag wirklich (`is_locked = 1`) und führt jede Migration samt Buchungszeile in einer eigenen Transaktion aus. Bleibt der Lock nach einem Absturz stehen, nennt die Fehlermeldung das SQL zum Freigeben.

**Neue Migration:** Klasse in `src/Database/Migrations` anlegen, in `Migrator::all()` eintragen, im `MigratorTest` die Liste `ALL` ergänzen und die neuen Tabellen und Indizes in `tests/fixtures/node-schema.json` nachtragen (erwartetes `sqlite_master` nach allen Migrationen). Bestehende Migrationen nie ändern (T-MIG-01).

Die Fixtures in `tests/fixtures/` sind eingefroren und belegen, dass Datenbanken aus der Zeit vor ADR 0018 weiterlaufen: `node-schema.json`, `node-0004.sqlite` und `node-latest.sqlite` stammen vom früheren Node-Server (Datenbank mit Inhalt vor und nach den Migrationen 0005–0015), `inline-plaintext.json` sind die Erwartungswerte für `InlineText::toPlainText` (Migration 0005), `search.json` die erwarteten Suchtreffer.

## Dateianhänge

ADR 0012. Ablage `ATTACHMENTS_DIR/<workspace>/<id>` im Volume (atomar über Temp-Datei und `rename`) oder Objekt `<workspace>/<id>` im S3-Bucket (`src/Attachments/S3Client.php`: SigV4 mit `S3Signer`, Versand mit ext-curl, ohne Redirects, 60 s Timeout; Path-Style oder virtueller Host, keine Presigned URLs).

- `PUT /api/attachments/:id/content` nimmt nur `application/octet-stream` an (sonst 415). Für diese Route gilt `ATTACHMENT_MAX_MB` als Body-Limit statt 1 MiB. Der Body wird ganz gelesen; `memory_limit` muss deshalb deutlich über `ATTACHMENT_MAX_MB` liegen (Default 25 MB, PHP-Default 128 MB reicht). `post_max_size` und `upload_max_filesize` gelten für `PUT` nicht.
- Größe und SHA-256 werden gegen die synchronisierten Metadaten geprüft; Quota (`WORKSPACE_STORAGE_MB`) und Dateigröße prüft schon der Sync-Push.
- `GET …/content` streamt die Datei; nur Rasterbilder inline, alles andere als Download, mit `nosniff`, `sandbox`-CSP und `no-store`, `Content-Disposition` nach RFC 6266.
- `Purge::deletedAttachments` entfernt Dateien gelöschter Anhänge nach `ATTACHMENT_RETENTION_DAYS`; aufgerufen wird es vom Cron.

## Web Push

ADR 0005. Abos mit den Fehlercodes `device_not_registered`, `endpoint_not_allowed` (nach `PUSH_ALLOWED_HOSTS`), `invalid_keys`, `endpoint_taken` und `too_many_subscriptions` (ab 20 Abos). VAPID-Schlüssel und Installations-ID liegen in `settings`. Der Hinweis enthält nur `{"type":"sync_available","installation","workspace"}`. Verschlüsselung (`WebPushCrypto`, RFC 8291) und VAPID (`Vapid`, RFC 8292) nur mit ext-openssl.

**Bündeln ohne Timer:** PHP hält zwischen Anfragen nichts, deshalb liegt pro Abo eine Zeile in `push_hints`:

- Nach einem Sync-Push mit angewandten, gemergten oder Konflikt-Operationen bekommt jedes andere Gerät des Owners einen fälligen Hinweis. Der erste nach einer Ruhepause ist sofort fällig, weitere innerhalb von 2 s nach dem letzten Versand werden zu einem Hinweis am Ende dieses Fensters gebündelt.
- Fällige Hinweise gehen nach der Antwort raus; einen gebündelten Hinweis wartet der Prozess nur unter PHP-FPM ab (höchstens 2 s). Sonst schickt ihn der nächste Sync-Push oder -Pull eines Geräts oder der Cron.
- Jeder Hinweis wird vor dem Versand per `update … where due_at = ?` beansprucht, parallele Worker senden ihn also nie doppelt. `404`/`410` des Push-Dienstes löschen das Abo, ebenso fünf Fehlversuche in Folge.
- Versand mit ext-curl (nur HTTPS, keine Redirects, 10 s Timeout). Für die Contract-Tests muss `curl` dem Zertifikat des Fake-Push-Dienstes vertrauen: `php -d curl.cainfo=$PUSH_RECEIVER_CA -S …`.

## Verlauf, Import und Export

- **Verlauf** (`src/History`, ADR 0013): Versionen sind Bearbeitungssitzungen pro Gerät (Abstand höchstens 10 Minuten), neueste zuerst, höchstens 200. Ein Stand wird aus dem Änderungslog der Seite und ihrer Blöcke zurückgerechnet; Blöcke nach Sortierschlüssel und ID.
- **Import** (`src/Import`, ADR 0004): `POST /api/import` legt aus einem JSON-Export (nur die aktuelle `schema_version`; ältere hebt der Client an) einen neuen Workspace an, in einer Transaktion: Entitäten mit IDs und Revisionen, Verlauf als Änderungslog, Suchindex. Prüfungen: Referenzen und Baumstruktur (`400 invalid_import`), Speicherlimit (`413 storage_limit`), vorhandene IDs (`409 ids_exist`). Body-Limit `IMPORT_MAX_MB`. Der Export wird als Ganzes dekodiert und geprüft; `memory_limit` sollte bei großen Importen etwa das Zehnfache der Exportgröße erlauben.
- **Sperre:** ein Import zur Zeit. Die PHP-Worker teilen keinen Speicher, deshalb hält der Import ein exklusives, nicht blockierendes `flock` auf `import.lock` neben der Datenbank; ist es belegt, antwortet der Server mit `429 import_running`. Das Betriebssystem gibt die Sperre am Ende der Anfrage frei, auch nach einem Absturz. Auf Netzlaufwerken ohne `flock`-Unterstützung (manche NFS-Mounts) ist die Sperre wirkungslos.
- **Export:** braucht keine eigenen Endpunkte. Der Client baut ihn aus der lokalen Datenbank, `GET /api/sync/log` (Verlauf, auch nach Kompaktierung) und den Anhängen (`GET /api/attachments/:id/content`).

## Sync und Suche

- `src/Sync`: `Apply::batch` wendet einen Push in einer Transaktion mit einem Savepoint je Operation an (#95): Revisionen, Tombstones, Block-Merge und Konfliktobjekte nach ADR 0003, Einträge in `changes`, Markierung für den Suchindex. Payloads bleiben `stdClass`, damit `{}` als `{}` gespeichert wird. `Mapping` macht aus Zeilen API-Objekte, `Snapshot` liefert den Zustand für einen Re-Sync (seitenweise, #97). Nach dem Batch plant `PushRoutes::afterChanges` die Hinweise an die anderen Geräte.
- `src/Search/SearchIndex.php` (#123): `reindexDocument` (Zeile über die Rowid aus `search_documents`), `markForReindex`/`reindexMarked` (`search_dirty`, #99), `toFtsQuery` und `searchWorkspace` (nur Workspaces des Owners).

## Cron und Kommandozeile

Periodische Arbeit macht `bin/cron.php`. Beim Hoster alle 5 Minuten eintragen (im Docker-Image läuft er von selbst):

```sh
*/5 * * * * php /pfad/zu/api/app/bin/cron.php
```

Ein Lauf löscht abgelaufene Sitzungen und Rate-Limit-Zähler, baut veraltete Sucheinträge neu (#99), verschickt fällige Push-Hinweise und entfernt Dateien gelöschter Anhänge nach `ATTACHMENT_RETENTION_DAYS`. Er schreibt eine JSON-Zeile ins Log; überlappende Läufe überspringt eine `flock`-Sperre (`cron.lock` neben der Datenbank). Fehlt der Cron, holen Anfragen das Nötige nach (Suchindex vor jeder Suche, Push-Hinweise nach Sync-Anfragen); nur das Aufräumen bleibt dann liegen.

`bin/console` (gleiche Konfiguration wie der Webserver; Ausgabe eine JSON-Zeile, Fehler auf stderr):

| Befehl | Zweck |
| --- | --- |
| `migrate` | ausstehende Migrationen anwenden (sonst macht das die erste Anfrage) |
| `backup [Zielordner]` | Datenbank (`VACUUM INTO`, konsistent im laufenden Betrieb) und Anhänge des Volumes nach `backup-<Zeit>/` mit `manifest.json`; Standardziel `<Datenverzeichnis>/backups` |
| `restore <Backup-Ordner> [--force]` | Backup prüfen und zurückspielen, danach migrieren und die Sequenznummern anheben (alle Geräte synchronisieren neu). Vorher die App vom Netz nehmen; `--force` ersetzt eine vorhandene Datenbank |
| `migrate-attachments-to-s3` | Anhänge aus dem Volume nach S3 kopieren und prüfen (#63), wiederholbar |
| `reset-password <E-Mail>` | neues Passwort setzen und alle Sitzungen beenden. Das Passwort kommt von stdin (`echo '…' \| bin/console reset-password a@b.de`); im Terminal ohne Eingabe wird eines erzeugt und ausgegeben |
| `metrics` | Prometheus-Metriken ausgeben (mit `METRICS_ENABLED`) |

Backups älterer Versionen (auch aus der Zeit vor ADR 0018) lassen sich zurückspielen und werden dabei migriert.

## Metriken

Mit `METRICS_ENABLED=true` gibt es `GET /api/metrics` im Prometheus-Textformat (ohne `true` antwortet die Route mit 404; im Docker-Stack nur über `php bin/console metrics`, weil das Backend FastCGI spricht). Da PHP zwischen Anfragen keine Zähler hält, liegen die Serien in der Tabelle `metrics`. Jede Anfrage wird nach der Antwort gezählt (`http_requests_total`, `http_request_duration_seconds` mit Routen-Vorlage wie `/api/workspaces/:id`, nie dem konkreten Pfad), dazu `sync_push_operations_total` und `sqlite_file_size_bytes`. Das kostet pro Anfrage einen kleinen Schreibzugriff; ohne `METRICS_ENABLED` entfällt er.

## Tests und Werkzeuge

| Befehl | Zweck |
| --- | --- |
| `composer test` | PHPUnit (`tests/`) |
| `composer analyse` | PHPStan, **Level max** (`phpstan.neon.dist`) |
| `composer cs` / `composer cs:fix` | PHP-CS-Fixer (PER-CS 2.0, `declare(strict_types=1)`) prüfen / korrigieren |
| `pnpm --filter @notion-alt/contract-tests test` (im Wurzelverzeichnis) | Contract-Tests gegen diesen Server |

Die CI (`.github/workflows/ci.yml`) führt PHPUnit, PHPStan und PHP-CS-Fixer auf PHP 8.2 und 8.3 aus (Job `php`) und die Contract-Tests im Job `checks`.
