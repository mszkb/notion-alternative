# 0018 – PHP-Backend mit Slim 4 für Shared Hosting

- **Status:** Accepted
- **Datum:** 2026-10-07, angenommen 2026-10-08

## Kontext

Die primäre Zielgruppe sind Umsteiger von Notion, auch weniger technikaffine ([`vision.md`](../product/vision.md)). Für sie ist Docker eine Hürde; gewöhnliches Webhosting mit PHP, HTTPS und Cron gibt es dagegen fast überall und günstig ([ADR 0011](0011-https-for-mobile-devices.md): „alle anderen: Webhosting“). Ein Node-Prozess läuft dort in der Regel nicht.

Der heutige Server (`apps/server`: Fastify, Kysely, better-sqlite3, zod; rund 4 900 Zeilen) ist an einen dauerhaft laufenden Prozess gebunden. Er hält Zustand im Speicher: Login-Rate-Limits (`auth/rate-limit.ts`), Entprellung der Push-Hinweise (`push/service.ts`), Import-Sperre, Metriken, Timer für Aufräumen und Suchindex.

Mit dem Owner abgestimmt ([#116](https://github.com/mszkb/notion-alternative/issues/116), [#117](https://github.com/mszkb/notion-alternative/issues/117)): PHP 8.2+, Slim 4, SQLite bleibt, Shared Hosting als Hauptweg, Docker bleibt. Das ADR hält diese Entscheidung mit ihren Folgen fest. Es betrifft [ADR 0006](0006-tech-stack.md) (Backend Fastify), [ADR 0007](0007-foundation-libraries.md) (Server-Bibliotheken) und [ADR 0010](0010-reference-deployment-and-https.md) (Referenz-Deployment nur Docker).

## Optionen

1. **Node beibehalten.**
   - **+** Kein Umbau, ein Stack, Schemas aus `@notion-alt/shared` direkt im Server.
   - **−** Auf Webhosting nicht installierbar; die Zielgruppe bleibt auf Docker oder Tailscale angewiesen.
2. **PHP mit Slim 4.**
   - **+** Kleiner Kern (Routing, Middleware, PSR-7), läuft mit `.htaccess` auf Apache und mit PHP-FPM hinter nginx.
   - **+** Wenige Abhängigkeiten, ein `vendor/` im Release-ZIP, kein Build auf dem Server.
   - **−** Zweite Sprache im Repo; Validierung, Merge und Inline-Parser müssen portiert werden.
3. **PHP mit Laravel.**
   - **+** Viel eingebaut (Queue, Cache, Migrationen).
   - **−** Groß, eigene Konventionen, mehr Angriffsfläche und Update-Last; das meiste davon brauchen wir nicht.
4. **PHP ohne Framework.**
   - **+** Keine Abhängigkeiten.
   - **−** Routing, Request-Parsing, Fehlerbehandlung und Middleware selbst bauen; mehr eigener Code mit Sicherheitsrisiko.

## Entscheidung

**Option 2: PHP 8.2+ mit Slim 4**, in `apps/server-php`, parallel zum Node-Server, bis die Contract-Tests ([#118](https://github.com/mszkb/notion-alternative/issues/118)) gegen beide grün sind. Danach wird PHP Standard und der Node-Server entfernt ([#129](https://github.com/mszkb/notion-alternative/issues/129)).

**Gleich bleibt:** das HTTP-API bis auf das Byte, also Pfade, Statuscodes, Fehlerobjekt `{error:{code,message,…}}`, Cookies und Sync-Protokoll ([ADR 0002](0002-sync-protocol.md)). Die SPA bleibt unverändert, installierte PWAs laufen ohne Update weiter.

**Laufzeit und Erweiterungen:**

| Pflicht | Wofür |
| --- | --- |
| PHP ≥ 8.2 | Enums, readonly-Eigenschaften |
| `pdo_sqlite` mit FTS5 | Datenbank und Volltextsuche; FTS5 wird beim Start geprüft, sonst klare Fehlermeldung |
| `openssl` | Web Push (ES256, AES-128-GCM, ECDH), S3-Signatur |
| `sodium` | Zufall, zeitkonstante Vergleiche, Argon2id für `password_hash` |
| `mbstring`, `json` | Texte, API |
| optional `apcu` | Cache für Rate-Limits und Entprellung; ohne APCu übernimmt die Datenbank |

**Composer-Abhängigkeiten:** `slim/slim` (^4), eine PSR-7-Implementierung (`slim/psr7`). Web Push nach RFC 8291 bauen wir selbst wie im Node-Server (gleiche Testvektoren). `minishlink/web-push` nehmen wir nur, wenn der Port daran scheitert. Validierung: eigene, schmale Schemas je Endpunkt nach dem Vorbild der zod-Schemas in `@notion-alt/shared`. Ein JSON-Schema-Export der zod-Schemas als gemeinsame Quelle wird in #119 geprüft.

**Zustand ohne Prozess:**

- Rate-Limits und Push-Entprellung kommen in eine Tabelle, optional mit APCu als Cache.
- Die Import-Sperre wird zu einer Zeile mit Ablaufzeit.
- Metriken: Zähler in einer Tabelle, `/metrics` liest sie.
- Timer werden zu `cron.php`: Aufräumen, verzögerter Suchindex, Push-Versand. Den Cron trägt man beim Hoster ein, z. B. alle 5 Minuten. Fehlt er, holt jede Anfrage begrenzte Arbeit nach (Suchindex vor jeder Suche, wie heute in #99).

**Passwörter:** Hashes mit `password_hash` und Argon2id (`PASSWORD_ARGON2ID`, Parameter in der Konfiguration; fehlt Argon2 in der PHP-Version des Hosters, bcrypt). `password_needs_rehash` hebt ältere Parameter beim nächsten Login an.

- **Keine Übernahme der scrypt-Hashes des Node-Servers** (Entscheidung des Owners, 2026-10-08): Es gibt keine produktiven Konten, nur Testkonten. Bestehende Konten melden sich nach der Umstellung nicht mehr an und werden neu registriert. Inhalte bleiben, da Workspaces und Daten in derselben Datenbank liegen; ein CLI-Befehl zum Neusetzen eines Passworts kommt mit [#127](https://github.com/mszkb/notion-alternative/issues/127).
- Der Node-Server versteht Argon2-Hashes nicht. Ein Rückweg nach der Umstellung geht nur per Backup von vorher ([Backup](../operations/backup.md)).

**Datenbank:**

- Dieselbe SQLite-Datei und dasselbe Anhang-Verzeichnis. Eine bestehende Installation wird ohne Export übernommen.
- Die Tabelle `kysely_migration` bleibt Quelle des Migrationsstands. PHP liest sie und führt ab `0013` eigene Migrationen mit denselben Namen in derselben Tabelle fort. Alte Migrationen werden nie erneut ausgeführt (T-MIG-01).
- Backups bleiben formatgleich (`manifest.json`), damit `restore` in beide Richtungen funktioniert, solange keine PHP-Migration gelaufen ist.

**Installationswege:**

- **Webhosting:** Release-ZIP hochladen (SPA + `api/` mit `vendor/`), Datenverzeichnis außerhalb des Webroots, Cron eintragen ([#128](https://github.com/mszkb/notion-alternative/issues/128)).
- **Docker Compose:** bleibt mit zwei Containern (nginx + PHP-FPM statt Node), auch für `linux/arm64`.

## Umsetzung (2026-10-08)

- Alle Endpunkte portiert ([#119](https://github.com/mszkb/notion-alternative/issues/119)–[#127](https://github.com/mszkb/notion-alternative/issues/127)); die Contract-Tests laufen vollständig grün gegen PHP. Der Node-Server ist entfernt ([#129](https://github.com/mszkb/notion-alternative/issues/129)), seine Fixtures für Migrationen und Suche sind eingefroren.
- Zustand ohne Prozess wie oben, mit zwei Abweichungen: Die Import-Sperre ist ein nicht blockierendes `flock` statt einer Zeile mit Ablaufzeit (das Betriebssystem gibt sie auch nach einem Absturz frei). Push-Hinweise werden über die Tabelle `push_hints` gebündelt und nach der Antwort verschickt (`fastcgi_finish_request`), Reste per Cron. Metriken liegen in der Tabelle `metrics`. APCu wird nicht genutzt.
- Docker: zwei Container bleiben; `frontend` (nginx) spricht FastCGI mit `backend` (PHP-FPM), der Cron läuft als Schleife im Entrypoint.
- Offen: Der PHP-Server prüft beim Login noch scrypt-Hashes des Node-Servers und ersetzt sie (`src/Auth/Scrypt.php`); das weicht von „keine Übernahme“ oben ab und wartet auf die Entscheidung des Owners (entfernen oder hier festhalten).

## Konsequenzen

- ADR 0006, 0007 und 0010 sind in den Server-Teilen ersetzt; die Frontend-Teile gelten weiter. Bis zur Umstellung (#129) bleibt der Node-Server die laufende Implementierung.
- Die Contract-Tests (#118) werden zur Spezifikation des Servers; Unit-Tests des Node-Servers entfallen mit ihm.
- Zwei Sprachen bis zur Umstellung. Änderungen am API müssen in beiden Servern landen. Neue Server-Features bis dahin möglichst zurückstellen.
- `@notion-alt/shared` bleibt für Client und Contract-Tests; der Server nutzt es nicht mehr.
- Offene Fragen, zu klären in den Folge-Issues: die Quelle der Validierungsschemas (#119), der Mindestumfang von `cron.php` ohne APCu (#127).
