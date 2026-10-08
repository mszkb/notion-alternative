# Installation auf Webspace

Für gewöhnliches Webhosting mit PHP, HTTPS und Cron, ohne Docker ([ADR 0018](../adr/0018-php-backend.md)). Es reichen FTP oder der Dateimanager des Hosters.

## Voraussetzungen

- PHP **8.2** oder neuer mit `pdo_sqlite` (SQLite mit FTS5), `mbstring`, `openssl`, `sodium`, `curl`
- Apache oder LiteSpeed mit `.htaccess` (`mod_rewrite`, `mod_headers`)
- HTTPS für die Domain (bei fast allen Hostern per Let's Encrypt im Kundenmenü)
- ein Cron-Eintrag (beim Hoster meist „Cronjobs“ oder „Geplante Aufgaben“)
- eine eigene (Sub-)Domain: Die App muss im Wurzelverzeichnis der Domain liegen, z. B. `https://notizen.example.de/`, nicht in `https://example.de/notizen/`.

## Installation

1. Das Release-ZIP `notion-alt-php-<Version>.zip` herunterladen und entpacken.
2. Den **Inhalt** des Ordners `notion-alt/` in das Webverzeichnis der Domain hochladen (oft `public_html/` oder `htdocs/`). Versteckte Dateien (`.htaccess`) mit hochladen.
3. Einen Ordner für die Daten **außerhalb** des Webverzeichnisses anlegen, z. B. `/home/<Benutzer>/notion-data`.
4. `api/app/config.example.php` als `api/app/config.php` kopieren und anpassen: `DATA_DIR` auf den Datenordner, `COOKIE_SECURE` auf `true`, zum Anlegen des ersten Kontos `ALLOW_REGISTRATION` auf `true`.
5. `https://<Domain>/api/check.php` öffnen. Die Seite prüft PHP-Version, Erweiterungen, FTS5, Schreibrechte, Lage des Datenordners und das Speicherlimit. Sind alle Punkte grün, `api/check.php` löschen.
6. Den Cron-Eintrag anlegen, alle 5 Minuten:

   ```sh
   php /home/<Benutzer>/public_html/api/app/bin/cron.php
   ```

   Manche Hoster verlangen den vollen Pfad zu PHP, z. B. `/usr/bin/php8.3`.
7. `https://<Domain>/` öffnen, das erste Konto registrieren, danach `ALLOW_REGISTRATION` wieder auf `false` setzen.

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
