# 0018 – PHP-Backend mit Slim 4 für Shared Hosting

- **Status:** Proposed
- **Datum:** 2026-10-06
- **Ersetzt teilweise:** [ADR 0006](0006-tech-stack.md) (Backend, Deployment), [ADR 0007](0007-foundation-libraries.md) (Server-Bibliotheken), [ADR 0010](0010-reference-deployment-and-https.md) (Referenz-Deployment)
- **Epic:** [#116](https://github.com/mszkb/notion-alternative/issues/116)

## Kontext

Self-Hosting soll so einfach wie möglich sein. Heute braucht eine Installation einen Host mit Docker oder einen dauerhaft laufenden Node-Prozess ([ADR 0006](0006-tech-stack.md), [ADR 0010](0010-reference-deployment-and-https.md)). Das haben die meisten Nutzer nicht: Fast jeder Webhoster bietet dagegen PHP mit SQLite, HTTPS inklusive. Mit Shared Hosting entfällt auch die offene HTTPS-Frage für Smartphones ([ADR 0011](0011-https-for-mobile-devices.md)), weil der Hoster das Zertifikat stellt.

Das Backend (`apps/server`, Fastify + better-sqlite3 + Kysely, rund 4 900 Zeilen TypeScript) soll deshalb in PHP neu geschrieben werden. Die Entscheidung für PHP 8.2+, Slim 4 und SQLite ist mit dem Owner abgestimmt. Dieses ADR hält sie fest und legt die Details fest, an die sich die Teil-Issues (#118–#129) halten.

Randbedingungen:

- Die Vue-SPA (`apps/web`) bleibt unverändert. Installierte PWAs mit Daten in IndexedDB müssen ohne Update weiterlaufen: gleiche Pfade, Statuscodes, Cookies und Fehlerobjekte `{error:{code,message,…}}`, gleiches Sync-Protokoll ([ADR 0002](0002-sync-protocol.md)).
- Bestehende Installationen werden ohne Datenverlust übernommen: gleiche SQLite-Datei, gleiches Anhang-Verzeichnis, gleiche Passwort-Hashes und Sessions.
- PHP ist shared-nothing: Jeder Request startet ohne Zustand, es gibt keine Timer und keinen Prozessspeicher. Auf Shared Hosting gibt es oft keine Umgebungsvariablen, kein Composer, kein CLI außer über Cron und ein Zeitlimit pro Request.

## Optionen

1. **Node-Server beibehalten** – kein Aufwand, keine Doppelimplementierung. Self-Hosting bleibt auf VPS/Pi mit Docker beschränkt; das Ziel „ZIP hochladen“ ist nicht erreichbar.
2. **PHP mit Slim 4** – Micro-Framework: Routing, Middleware, PSR-7/PSR-15, sonst nichts. Wenige Abhängigkeiten, die sich vollständig in ein ZIP packen lassen (`vendor/` inklusive). Struktur ähnelt dem heutigen Fastify-Server (Routen-Module, Fehler-Handler), der Port ist direkt.
3. **PHP mit Laravel** – viel eingebaut (Migrationen, Validierung, Queue, Scheduler). Groß (Dutzende Pakete, eigener Migrationsmechanismus, Konventionen für Schema und Sessions), Installation ohne CLI auf Shared Hosting mühsam. Das bestehende Schema und die `kysely_migration`-Tabelle passen nicht zu Laravels Migrator.
4. **PHP ohne Framework** – null Abhängigkeiten. Routing, Request/Response, Middleware und Fehlerbehandlung müssten selbst geschrieben und gepflegt werden; kein Standard, an dem sich Beiträge orientieren können.

## Entscheidung

**Option 2: PHP ≥ 8.2 mit Slim 4.** Der neue Server entsteht in `apps/server-php` parallel zum Node-Server. Erst wenn die Contract-Tests (#118) gegen beide Server grün sind, wird umgestellt und der Node-Server entfernt (#129).

### Laufzeit und Extensions

| | |
| --- | --- |
| PHP | **≥ 8.2** (8.1 ist ohne Sicherheitsupdates); CI testet 8.2 und die aktuelle Version |
| Pflicht | `pdo_sqlite` **mit FTS5** (beim Start geprüft, sonst klare Fehlermeldung), `openssl` (Web Push: ECDH, AES-GCM, ES256), `curl` (Web Push, S3), `mbstring`, `json`, `hash` |
| Optional | `apcu` (Metriken, Cache); ohne APCu laufen Metriken über SQLite oder sind aus |
| Nicht nötig | `sodium`: Die vorhandene libsodium-scrypt-Funktion verlangt 32-Byte-Salts, die gespeicherten Hashes haben 16 Byte (siehe Passwörter) |

### Composer-Abhängigkeiten

| Zweck | Paket |
| --- | --- |
| Framework | `slim/slim` ^4 |
| PSR-7 / PSR-17 | `slim/psr7` |
| Entwicklung | `phpunit/phpunit`, `phpstan/phpstan` (Level wird in #119 festgelegt, Ziel: max), `friendsofphp/php-cs-fixer` |

Bewusst **keine** weiteren Laufzeitbibliotheken:

- **Validierung:** eigener, kleiner Port der zod-Schemas aus `packages/shared`. Gleiche Transformationen (E-Mail trim + lowercase, Namen trim), strikte Objekte, Fehler als 400 `invalid_input` mit `issues[{path,message}]`. Pfade und Codes müssen übereinstimmen, die Meldungstexte nicht (der Client zeigt sie nicht an).
- **Web Push:** eigene Implementierung wie heute ([ADR 0005](0005-push.md), RFC 8291/8292) mit `openssl`; die RFC-Testvektoren aus `apps/server/test` werden übernommen. `minishlink/web-push` bringt mehrere Abhängigkeiten (u. a. Guzzle) für wenige Zeilen Krypto.
- **S3:** eigene SigV4-Signatur wie heute (`apps/server/src/attachments/s3.ts`) mit `curl`, gleiche Testvektoren.
- **Datenbank:** PDO direkt, SQL von Hand, schmale Repository-Funktionen wie heute. Kein ORM.

### Datenbank und Migrationen

- Weiterhin **eine SQLite-Datei** (`DATABASE_PATH`, Default `DATA_DIR/app.sqlite`). Pragmas wie heute: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Der PHP-Migrator nutzt **dieselben Tabellen** `kysely_migration(name, timestamp)` und `kysely_migration_lock` und dieselben Migrationsnamen (`0001_initial` … `0011_snapshot_paging`). Eine vom Node-Server erzeugte Datenbank wird erkannt und weitergeführt; eine neue bekommt dasselbe Schema. Ein Test vergleicht `sqlite_master` beider Varianten.
- Solange beide Server existieren, wird **jede neue Migration in beiden** angelegt (im Node-Server notfalls als No-op). Kysely bricht ab, wenn die Datenbank eine Migration enthält, die es nicht kennt; sonst wäre ein Zurück auf den Node-Server unmöglich.

### Ersatz für Prozess-Zustand

| Heute (Node, ein Prozess) | PHP |
| --- | --- |
| Login-/Registrierungs-Rate-Limit im Speicher (`AttemptLimiter`) | Tabelle `auth_attempts` (Schlüssel, Zähler, Fensterende), abgelaufene Zeilen werden beim Schreiben und per Cron gelöscht |
| Push-Entprellung per `setTimeout` (2 s) | Tabelle mit ausstehenden Hinweisen; Versand nach der Antwort (`fastcgi_finish_request`, wo verfügbar) und per Cron. Push bleibt nur ein Hinweis (Prinzip 4) |
| Import-Sperre (`running`-Flag) | `flock` auf eine Datei in `DATA_DIR` (Antwort weiterhin 429 `import_running`) |
| Täglicher Timer: gelöschte Anhänge entfernen, abgelaufene Sessions | **Cron-Einstiegspunkt** `bin/cron.php` (Shared Hosting: Cron im Hoster-Panel). Ohne Cron läuft die Wartung höchstens einmal pro Tag am Ende eines Requests (Zeitstempel in `settings`) |
| Metriken im Speicher (`/api/metrics`) | APCu, wenn vorhanden; sonst Zähler in SQLite oder Metriken aus. Details in #127 |
| CLI-Befehle `backup`, `restore`, `migrate-attachments-to-s3` | `bin/console` mit denselben Befehlen und Ausgaben (#127) |

### Passwörter

Gespeichert ist `scrypt$N$r$p$salt$hash` (N=2^15, r=8, p=1, 16-Byte-Salt). PHP hat kein natives scrypt mit diesen Parametern. Entscheidung:

- **Bestehende scrypt-Hashes** prüft eine reine PHP-Implementierung (RFC 7914, mit Testvektor). Messung eines Prototyps (PHP 8.3, Salsa20/8 ausgerollt, `V` als gepackte Strings): 4,5 s ohne und 1,1 s mit OPcache-JIT bei 44 MB Speicher. Das fällt nur einmal pro Konto an (danach Rehash) und ist dafür vertretbar; die Doku empfiehlt JIT.
- Nach erfolgreichem Login wird der Hash mit `password_hash()` neu erzeugt (**Argon2id**, falls verfügbar, sonst bcrypt). Neue Konten und Passwortänderungen nutzen direkt `password_hash()`. `verifyPassword` akzeptiert beide Formate.
- Folge: Nach dem ersten Login über den PHP-Server kann der Node-Server dieses Konto nicht mehr prüfen. Ein Zurück auf Node ist dann nur mit Passwort-Reset möglich. Das ist akzeptiert, weil der Node-Server nach der Umstellung entfernt wird; die Upgrade-Doku weist darauf hin.

Sessions (zufälliges 256-Bit-Token, in der DB nur der SHA-256-Hash, Cookie `HttpOnly`, `SameSite=Strict`, `Path=/api`) bleiben unverändert, bestehende Sessions gelten weiter.

### Konfiguration

Dieselben Variablen wie `apps/server/src/config.ts`, leere Strings gelten als nicht gesetzt. Quelle: Umgebung **oder** eine `config.php` außerhalb des Webroots (Shared Hosting kennt oft keine Umgebungsvariablen). `HOST`/`PORT` entfallen (der Webserver bestimmt sie).

### Installationswege

- **Shared Hosting (Hauptweg):** Ein Release-ZIP enthält die gebaute SPA und `api/` mit `index.php`, `.htaccess` (Rewrite auf `index.php`) und `vendor/`. Daten (`app.sqlite`, Anhänge, `config.php`) liegen außerhalb des Webroots oder in einem per `.htaccess` gesperrten Verzeichnis. Cron-Eintrag für `bin/cron.php`.
- **Docker Compose (Pi/VPS):** weiterhin zwei Container (`frontend` mit nginx, `backend` mit PHP auf Basis eines offiziellen, multi-arch PHP-Images), weiterhin `linux/arm64`. Details in #128.

## Konsequenzen

- Self-Hosting ohne Docker und ohne Node wird möglich; HTTPS liefert auf Shared Hosting der Hoster.
- **Zwei Sprachen:** Logik, die heute Client und Server aus `packages/shared` teilen (zod-Schemas, `inlineToPlainText`, Import-Migrationen des Exportformats), existiert serverseitig ein zweites Mal in PHP. Gegenmittel: Contract-Tests (#118) gegen beide Server und gemeinsame Fixtures (`apps/server/test/fixtures/exports`, RFC-Testvektoren). Das Begründungsargument „ein Code für Sync und Schemas“ aus ADR 0006 gilt für den Server nicht mehr.
- Bis zur Umstellung laufen zwei Server parallel; Migrationen und API-Änderungen müssen in beiden landen (siehe oben). Neue Features am Server warten möglichst bis nach #129.
- Grenzen von Shared Hosting werden zu Betriebsgrenzen: `max_execution_time` (Import, Snapshot, große Pushes), `upload_max_filesize`/`post_max_size` (Anhänge, `ATTACHMENT_MAX_MB`, `IMPORT_MAX_MB`), kein dauerhafter Prozess. Die Doku nennt die nötigen PHP-Einstellungen; der Server meldet zu kleine Werte beim Start bzw. in `/api/ready`.
- SQLite bleibt: ein Schreiber gleichzeitig, für Einzelanwender und kleine Teams ausreichend. Backup bleibt SQLite-Backup + Anhang-Verzeichnis.
- Lokale Werkzeuge bleiben Node/pnpm (SPA, `packages/shared`, Contract-Tests, Playwright). Für den Server kommen Composer, PHPUnit, PHPStan und PHP-CS-Fixer hinzu, mit eigenem CI-Job.
- Folgeaufgaben: #118 (Contract-Tests) und #119 (Grundgerüst) zuerst, dann #120–#127 Funktion für Funktion, #128 Deployment, #129 Umstellung und Rückbau.

## Offene Punkte für den Owner

1. **Passwort-Rehash:** Ist akzeptiert, dass nach dem ersten PHP-Login kein Rückweg auf den Node-Server ohne Passwort-Reset besteht? Alternative: neue Hashes mit PBKDF2-SHA256 (beide Server können sie prüfen, aber schwächer gegen GPU-Angriffe als scrypt/Argon2id).
2. **ADR 0011 (HTTPS für Smartphones):** Mit Shared Hosting als Hauptweg könnte 0011 auf „Docker-Installation: wie bisher SSH-Tunnel oder eigener Reverse Proxy“ verkleinert werden. Entscheidung dort.
