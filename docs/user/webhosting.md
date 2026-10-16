# Installation auf Webspace

Für gewöhnliches Webhosting mit PHP, HTTPS und Cron, ohne Docker ([ADR 0018](../adr/0018-php-backend.md)). Es reichen FTP oder der Dateimanager des Hosters.

## Voraussetzungen

- PHP **8.2** oder neuer mit `pdo_sqlite` (SQLite mit FTS5), `mbstring`, `openssl`, `sodium`, `curl`
- optional statt SQLite: eine MariaDB- oder MySQL-Datenbank des Hosters (MariaDB ab 10.11, MySQL ab 8.4) und `pdo_mysql`, siehe [Mit der Datenbank des Hosters](#mit-der-datenbank-des-hosters)
- Apache oder LiteSpeed mit `.htaccess` (`mod_rewrite`, `mod_headers`)
- HTTPS für die Domain (bei fast allen Hostern per Let's Encrypt im Kundenmenü)
- ein Cron-Eintrag (beim Hoster meist „Cronjobs“ oder „Geplante Aufgaben“)
- eine eigene (Sub-)Domain: Die App muss im Wurzelverzeichnis der Domain liegen, z. B. `https://notizen.example.de/`, nicht in `https://example.de/notizen/`.

Getestet ist das Paket mit Apache 2.4, PHP als Apache-Modul (`scripts/webspace-test.sh`) und über PHP-FPM. Auf einem echten Webspace und mit LiteSpeed ist es noch nicht erprobt; Rückmeldungen dazu bitte als Issue.

## Installation

1. Das Release-ZIP `notion-alt-php-<Version>.zip` herunterladen und entpacken.
2. Den **Inhalt** des Ordners `notion-alt/` in das Webverzeichnis der Domain hochladen (oft `public_html/` oder `htdocs/`). Versteckte Dateien (`.htaccess`) mit hochladen.
3. Einen Ordner für die Daten **außerhalb** des Webverzeichnisses anlegen, z. B. `/home/<Benutzer>/notion-data`.
4. `api/app/config.example.php` als `api/app/config.php` kopieren und anpassen: `DATA_DIR` auf den Datenordner, `COOKIE_SECURE` auf `true`, zum Anlegen des ersten Kontos `ALLOW_REGISTRATION` auf `true`. Läuft die App auf einem eigenen Server im Heimnetz ohne Proxy davor, zusätzlich `TRUST_PROXY` auf `false` (siehe [Deployment](../operations/deployment.md#login-rate-limiting)).
5. `https://<Domain>/api/check.php` öffnen. Die Seite prüft PHP-Version, Erweiterungen, FTS5, Schreibrechte, Lage des Datenordners und das Speicherlimit. Sind alle Punkte grün, `api/check.php` löschen. Sobald das erste Konto angelegt ist, zeigt die Seite ohnehin nichts mehr außer diesem Hinweis.
6. Den Cron-Eintrag anlegen, alle 5 Minuten:

   ```sh
   php /home/<Benutzer>/public_html/api/app/bin/cron.php
   ```

   Manche Hoster verlangen den vollen Pfad zu PHP, z. B. `/usr/bin/php8.3`.
7. `https://<Domain>/` öffnen, das erste Konto registrieren, danach `ALLOW_REGISTRATION` wieder auf `false` setzen.

## Mit der Datenbank des Hosters

Ohne weitere Angaben speichert die App alles in einer SQLite-Datei im Datenordner, eine Datenbank muss niemand anlegen. Bietet der Hoster eine MariaDB- oder MySQL-Datenbank an (im Kundenmenü oft „MySQL-Datenbank“, auch wenn MariaDB dahinter läuft), kann die App stattdessen diese nutzen ([ADR 0024](../adr/0024-mysql-mariadb-option.md)). Das hilft z. B., wenn der Hoster Dateien auf Netzlaufwerken ablegt, wo SQLite unzuverlässig ist.

1. Im Kundenmenü eine neue, leere Datenbank anlegen und Name, Benutzer, Passwort und Server notieren.
2. In `api/app/config.php` die Zeilen `DB_HOST`, `DB_NAME`, `DB_USER` und `DB_PASSWORD` einkommentieren und ausfüllen (`DB_PORT`, falls nicht 3306). Den Datenordner (`DATA_DIR`) braucht die App weiterhin für Anhänge.
3. `api/check.php` zeigt dann statt SQLite die Verbindung und welche Datenbank in welcher Version tatsächlich läuft.

Die Tabellen legt die App bei der ersten Anfrage selbst an. Unterschied zu SQLite: Die Suche auf dem Server findet keine Wörter mit weniger als drei Buchstaben und sortiert Treffer etwas anders. Die Suche in der App selbst findet sie trotzdem, sie läuft auf dem Gerät.

Umziehen lässt sich jederzeit, in beide Richtungen: mit SSH `php api/app/bin/console db:copy <alte Datenbank>` (Details in [Backup, Restore und Upgrade](../operations/backup.md#umzug-zwischen-sqlite-und-mariadbmysql)), ohne SSH über Export und Import in der App.

## Update

Neues ZIP entpacken und alles außer `api/app/config.php` überschreiben. Die Datenbank wird bei der ersten Anfrage migriert. Vorher ein Backup anlegen (unten).

## Backup

Mit SSH-Zugang:

```sh
php api/app/bin/console backup /home/<Benutzer>/notion-backups
```

Ohne SSH: den Datenordner per FTP sichern, während niemand die App benutzt, oder in der App den Export nutzen ([Export und Import](export.md)). Weitere Befehle (`restore`, `reset-password`) stehen in [`apps/server/README.md`](../../apps/server/README.md#cron-und-kommandozeile).

## Umzug von der Docker-Version

Webspace und Docker nutzen dieselbe Datenbank und dieselbe Ablage der Anhänge. Ein Backup der Docker-Version (`docker compose exec -T backend php bin/console backup`, bei der älteren Node-Version `… node dist/index.js backup`, siehe [Backup](../operations/backup.md)) lässt sich mit `php api/app/bin/console restore <Backup-Ordner>` einspielen. Passwörter aus der Node-Version werden nicht übernommen ([ADR 0018](../adr/0018-php-backend.md)): Jedes Konto bekommt mit `php api/app/bin/console reset-password <E-Mail>` ein neues.
