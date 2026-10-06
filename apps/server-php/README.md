# PHP-Server (Slim 4)

Neuimplementierung des Backends in PHP für Shared Hosting ([ADR 0018](../../docs/adr/0018-php-backend.md), Epic [#116](https://github.com/mszkb/notion-alternative/issues/116)). Der Server entsteht parallel zu `apps/server` (Node) und übernimmt dessen HTTP-API, SQLite-Datei und Migrationen. Stand: Grundgerüst ([#119](https://github.com/mszkb/notion-alternative/issues/119)) mit `GET /api/health` und `GET /api/ready`; Auth, Sessions, Workspaces und Geräte ([#120](https://github.com/mszkb/notion-alternative/issues/120)): `/api/auth/*`, `/api/workspaces`, `/api/devices`. Die übrigen Endpunkte folgen in #121–#127.

## Voraussetzungen

- PHP **≥ 8.2**
- Extensions: `pdo_sqlite` (SQLite **mit FTS5**), `mbstring`, `json`
- Später zusätzlich (Web Push, S3): `openssl`, `curl`
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

Die SPA im Entwicklungsmodus (`pnpm dev`) spricht weiter mit dem Node-Server auf `:3000`.

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

## Konfiguration

Dieselben Variablen, Defaults und Prüfungen wie `apps/server/src/config.ts` (siehe [`docs/operations/deployment.md`](../../docs/operations/deployment.md)), ohne `HOST` und `PORT` (die bestimmt der Webserver). Leere Werte gelten als nicht gesetzt.

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
- **Hashes des Node-Servers** (`scrypt$N$r$p$salt$hash`) prüft `src/Auth/Scrypt.php` (reines PHP, RFC 7914). Das dauert einige Sekunden pro Login (OPcache-JIT beschleunigt es deutlich), aber nur einmal: Nach dem ersten erfolgreichen Login wird der Hash durch einen `password_hash()`-Hash ersetzt. Danach kann der Node-Server dieses Konto nicht mehr prüfen (ADR 0018, offene Frage 1).
- Für unbekannte E-Mail-Adressen wird gegen einen festen Dummy-Hash desselben Verfahrens geprüft, damit die Antwortzeit keine Konten verrät.
- **Rate-Limits** (`LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_MAX_FAILURES_PER_EMAIL`, `REGISTER_MAX_ATTEMPTS_PER_IP`, `AUTH_RATE_LIMIT_WINDOW_MINUTES`) wie beim Node-Server (festes Fenster pro Schlüssel, 429 `too_many_attempts` mit `retryAfter` und Header `Retry-After`). Da PHP zwischen Anfragen nichts im Speicher behält, liegen die Zähler in der Tabelle `auth_attempts`; abgelaufene Zeilen löscht jeder schreibende Zugriff.

## Migrationen

`src/Database/Migrations` enthält je eine Klasse pro Node-Migration (`0001_initial` … `0012_auth_attempts`) mit exakt der DDL, die Kysely erzeugt. `0012_auth_attempts` (Zähler der Rate-Limits) nutzt nur der PHP-Server; der Node-Server legt die Tabelle an, zählt aber im Speicher. Der Migrator nutzt Kyselys Tabellen `kysely_migration` und `kysely_migration_lock` (gleiche DDL, gleiches Zeitstempelformat): Eine vom Node-Server angelegte Datenbank wird erkannt und fortgeführt, eine neue bekommt dasselbe Schema. Unbekannte Migrationsnamen (z. B. von einer neueren Version) brechen wie bei Kysely ab.

Anders als Kysely unter SQLite (ein Prozess) laufen PHP-Anfragen parallel: Der Migrator setzt den Lock-Eintrag wirklich (`is_locked = 1`) und führt jede Migration samt Buchungszeile in einer eigenen Transaktion aus. Bleibt der Lock nach einem Absturz stehen, nennt die Fehlermeldung das SQL zum Freigeben.

**Neue Migration:** solange beide Server existieren, in beiden anlegen (ADR 0018). Die Node-Migration schreiben, dann die Fixtures neu erzeugen und die PHP-Klasse mit derselben DDL ergänzen (in `Migrator::all()` eintragen):

```sh
pnpm --filter @notion-alt/server exec tsx scripts/dump-php-fixtures.ts
```

Das Skript schreibt nach `tests/fixtures/`: `node-schema.json` (`sqlite_master` einer frischen Node-Datenbank), `node-0004.sqlite` und `node-latest.sqlite` (Datenbank mit Inhalt vor und nach den Node-Migrationen 0005–0012) und `inline-plaintext.json` (Erwartungswerte für den PHP-Port von `inlineToPlainText`, den Migration 0005 braucht).

## Tests und Werkzeuge

| Befehl | Zweck |
| --- | --- |
| `composer test` | PHPUnit (`tests/`) |
| `composer analyse` | PHPStan, **Level max** (`phpstan.neon.dist`) |
| `composer cs` / `composer cs:fix` | PHP-CS-Fixer (PER-CS 2.0, `declare(strict_types=1)`) prüfen / korrigieren |

PHPStan läuft auf Level `max` (ADR 0018). Die CI (`.github/workflows/ci.yml`, Job `php`) führt alle drei auf PHP 8.2 und 8.3 aus.
