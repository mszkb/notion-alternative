# Einrichtung bei Hostern

Was bei verbreiteten Hostern vor dem [Hochladen per FTP](ftp-upload.md) einzustellen ist: Subdomain mit eigenem Ordner, HTTPS, PHP-Version, Zugangsdaten, Pfad des Datenordners und Cron. Die allgemeinen Schritte stehen in [Installation auf Webspace](webhosting.md).

> **Stand Oktober 2026, nicht auf jedem Hoster erprobt.** Die Kundenmenüs ändern sich häufig, Menünamen können abweichen, und manche Funktionen gibt es nur in größeren Tarifen. Im Zweifel die verlinkte Hilfe des Hosters lesen. Ob das Paket bei dir läuft, zeigt `api/check.php` zuverlässig. Erfahrungen und Korrekturen bitte als Issue melden.

## Überblick

| Hoster | Oberfläche | PHP 8.2+ einstellen | SFTP | Cron für `cron.php` |
| --- | --- | --- | --- | --- |
| [IONOS](#ionos) | Kundenbereich | ja, pro Domain | ja | über SSH (`crontab -e`) bzw. Cronjob-Verwaltung, je nach Tarif |
| [STRATO](#strato) | Kunden-Login | Kunden-Login bzw. `.htaccess` | ja | auf der älteren Plattform ab „Hosting Plus“ |
| [ALL-INKL.COM](#all-inklcom) | KAS | ja, pro Domain | ja (SSH-Login) | nein, nur Aufruf von URLs |
| [Hetzner](#hetzner-webhosting) | konsoleH | ja | ja | Cronjob-Manager, Anzahl je nach Tarif |
| [netcup](#netcup-webhosting) | WCP (Plesk) | ja, pro Domain | ja | „Geplante Aufgaben“ |
| [Hostinger](#hostinger) | hPanel | ja | ja (SSH ab mittleren Tarifen) | „Cron Jobs“ |

Ohne Cron läuft die App trotzdem: Sync, Suche und Anmeldung holen nach, was sie brauchen. Es entfallen nur Aufräumarbeiten (abgelaufene Sitzungen, endgültig gelöschte Anhänge belegen weiter Platz) und Push-Hinweise kommen später an ([ADR 0018](../adr/0018-php-backend.md)).

**Allgemein gilt:**

- Die App braucht eine eigene (Sub-)Domain, die auf einen eigenen Ordner zeigt, z. B. `notizen.example.de` → `/notizen`.
- Für den Datenordner einen Ordner anlegen, auf den keine Domain zeigt, z. B. `/notion-data` neben `/notizen`. Zeigt die Hauptdomain auf den Startordner des Webspace, ist ein Ordner darin öffentlich: Dann die Hauptdomain auf einen Unterordner umstellen oder einen Ordner außerhalb nehmen, wie bei den Hostern unten beschrieben.
- Wenn dein Hoster fehlt: Die Begriffe heißen fast überall ähnlich („Subdomain“, „Document Root“/„Zielverzeichnis“, „SSL/Let's Encrypt“, „PHP-Version“, „Cronjobs“). Bei cPanel- und Plesk-Hostern entsprechen die Schritte denen von Hostinger bzw. netcup.

## IONOS

1. **Subdomain:** **Domains & SSL** → Domain → **Subdomain erstellen**, z. B. `notizen`. Danach bei der Subdomain **Verwendungsart/Ziel anpassen** → **Webspace** → Verzeichnis `/notizen` wählen oder neu anlegen.
2. **HTTPS:** Bei der Subdomain unter **SSL** das im Tarif enthaltene Zertifikat zuweisen. Die Zuweisung kann einige Minuten dauern.
3. **PHP:** **Hosting** → **PHP** → bei der Subdomain PHP **8.3** wählen (8.2 geht auch). [Hilfe](https://www.ionos.com/help/hosting/php/)
4. **Zugang:** **Hosting** → **SFTP & SSH**: Server (`access-….webspace-host.com` o. ä.), Benutzer, Passwort.
5. **Datenordner:** Bei IONOS zeigt die Hauptdomain oft auf den Startordner `/`. Dann die Hauptdomain auf einen Unterordner umstellen, bevor `notion-data` im Startordner liegt, oder `notion-data` mit der `.htaccess` aus der [FTP-Anleitung](ftp-upload.md#4-datenordner-schützen) schützen und prüfen, dass `https://<Hauptdomain>/notion-data/` „403 Forbidden“ liefert. Der absolute Pfad hängt vom Vertrag ab (ältere: `/homepages/<Nr>/<Kennung>/htdocs/…`, neuere: `/home/www/…`); einfacher ist der relative Pfad `../../../notion-data` aus der FTP-Anleitung.
6. **Cron:** Mit SSH-Zugang per `crontab -e`:

   ```text
   */5 * * * * /usr/bin/php8.3-cli -f /<absoluter Pfad>/notizen/api/app/bin/cron.php
   ```

   Den absoluten Pfad zeigt `pwd` nach dem SSH-Login. Die PHP-Version im Befehl (`php8.3-cli`) zur eingestellten Version passend wählen. [Hilfe zu Cronjobs](https://www.ionos.de/hilfe/hosting/cronjobs/best-practices-fuer-die-einrichtung-von-cronjobs/)

## STRATO

1. **Subdomain:** **Domains** → **Domainverwaltung** → **Subdomain anlegen**, z. B. `notizen`. Bei der Subdomain unter **Einstellungen** das Ziel auf das Verzeichnis `/notizen` im Webspace setzen.
2. **HTTPS:** Bei der Subdomain unter **SSL-Verwaltung** das im Paket enthaltene Zertifikat aktivieren.
3. **PHP:** STRATO stellt die Version teils im Kunden-Login, teils nur noch per `.htaccess` um ([FAQ](https://www.strato.de/faq/hosting/so-stellen-sie-ihre-php-version-manuell-um/)). Zeigt `api/check.php` eine zu alte Version, in `notizen/.htaccess` oben ergänzen:

   ```apache
   AddType application/x-httpd-php83 .php
   ```

   Nach jedem Update erneut eintragen, das Update überschreibt die Datei.
4. **Zugang:** **Hosting** → **SFTP/SSH**: Server `ssh.strato.de`, Benutzer ist die Domain oder die Kundennummer, Passwort im Kunden-Login festlegen.
5. **Datenordner:** Den absoluten Pfad nennt die Paketübersicht unter **Webspace Pfad**. `DATA_DIR` ist dann `<Webspace Pfad>/notion-data`, oder relativ `../../../notion-data`.
6. **Cron:** Auf der älteren Hosting-Plattform ab „Hosting Plus“, auf der neueren Plattform laut STRATO noch nicht ([FAQ](https://www.strato.de/faq/hosting/so-einfach-richten-sie-ihre-cron-jobs-ein/)). Unter **Cron-Jobs** → **Neuen Cron-Job anlegen**, Intervall 5 Minuten (sonst das kürzeste angebotene), Befehl relativ zum Webspace:

   ```text
   /bin/php -f ./notizen/api/app/bin/cron.php
   ```

## ALL-INKL.COM

1. **Subdomain:** Im KAS **Domain** → **Subdomains** → **Neue Subdomain anlegen**, z. B. `notizen`, **Zielverzeichnis** `/notizen/`.
2. **HTTPS:** Bei der Subdomain **bearbeiten** → **SSL-Schutz** → **Let's Encrypt** aktivieren.
3. **PHP:** Bei der Subdomain **bearbeiten** → **PHP-Version** auf 8.3 stellen.
4. **Zugang:** Die FTP-Zugangsdaten stehen im KAS bzw. in der Zugangsdaten-E-Mail (Server `w0123456.kasserver.com`). SFTP geht mit den SSH-Zugangsdaten, wo der Tarif SSH enthält; sonst FTP mit TLS.
5. **Datenordner:** Der absolute Pfad hat die Form `/www/htdocs/w0123456/notion-data`. Zeigt die Hauptdomain auf `/`, siehe die allgemeinen Hinweise oben.
6. **Cron:** Die Cronjobs im KAS rufen nur URLs auf; `cron.php` lässt sich so bewusst nicht starten. Den Cron-Schritt auslassen. Die Folgen stehen oben im Überblick.

## Hetzner (Webhosting)

1. **Subdomain:** In der konsoleH die Domain wählen → **Einstellungen** → **Subdomains**, Subdomain `notizen` auf das Verzeichnis `notizen` anlegen.
2. **HTTPS:** **Einstellungen** → **SSL-Manager** → Let's-Encrypt-Zertifikat für die Subdomain beantragen.
3. **PHP:** **Einstellungen** → **PHP-Konfiguration** → PHP 8.3.
4. **Zugang:** **Zugangsdaten** in der konsoleH: Server, FTP-Benutzer, Passwort; SFTP mit denselben Daten.
5. **Datenordner:** Die Webordner liegen unter `/usr/www/users/<Benutzer>/`. Für die Daten eignet sich das Home-Verzeichnis `/usr/home/<Benutzer>/notion-data`, das keine Domain ausliefert.
6. **Cron:** **Einstellungen** → **Cronjob-Manager**, alle 5 Minuten, Befehl:

   ```text
   /usr/bin/php /usr/www/users/<Benutzer>/notizen/api/app/bin/cron.php
   ```

   Wie viele Cronjobs möglich sind, hängt vom Tarif ab. [Doku konsoleH](https://docs.hetzner.com/de/managed/administration-on-konsoleh/)

## netcup (Webhosting)

netcup verwaltet Webhosting im WCP, einem Plesk. Im CCP beim Produkt den Link zum WCP öffnen.

1. **Subdomain:** **Websites & Domains** → **Subdomain hinzufügen**, Name `notizen`, **Dokumentenstamm** z. B. `notizen.example.de`. Plesk legt den Ordner selbst an.
2. **HTTPS:** Bei der Subdomain **SSL/TLS-Zertifikate** → **Let's Encrypt** → **Kostenlos installieren**.
3. **PHP:** Bei der Subdomain **PHP** → Version 8.3 (FPM). Dort lassen sich auch `memory_limit`, `upload_max_filesize` und `post_max_size` erhöhen.
4. **Zugang:** **FTP-Zugang** bzw. die Zugangsdaten im CCP. Schneller als FTP: das ZIP im **Dateimanager** hochladen, dort **Entpacken** und den Inhalt von `notion-alt/` in den Dokumentenstamm verschieben.
5. **Datenordner:** Die Websites liegen unter `/var/www/vhosts/<Hauptdomain>/`. Im Dateimanager auf dieser obersten Ebene `notion-data` anlegen: `DATA_DIR` ist `/var/www/vhosts/<Hauptdomain>/notion-data`.
6. **Cron:** **Geplante Aufgaben** → **Aufgabe hinzufügen** → Aufgabentyp **PHP-Skript ausführen**, Skriptpfad `<Dokumentenstamm>/api/app/bin/cron.php`, PHP-Version wie oben, alle 5 Minuten (`*/5 * * * *`). Fehlt der Aufgabentyp, als Befehl `/usr/bin/php /var/www/vhosts/<Hauptdomain>/<Dokumentenstamm>/api/app/bin/cron.php`. [Hilfe](https://www.netcup.com/en/helpcenter/documentation/web-hosting/scheduled-tasks)

## Hostinger

Hostinger setzt LiteSpeed ein. Das Paket ist dort noch nicht erprobt; die `.htaccess` ist auf Apache-Kompatibilität ausgelegt. Rückmeldungen besonders willkommen.

1. **Subdomain:** hPanel → **Websites** → Website **Verwalten** → **Domains** → **Subdomains**, Name `notizen`, das Häkchen bei „Eigenen Ordner“ setzen und einen Ordner wählen. Ohne eigenen Ordner legt Hostinger ihn in `public_html/` der Hauptdomain an.
2. **HTTPS:** Hostinger stellt das Zertifikat meist selbst aus; sonst **Sicherheit** → **SSL** → **Installieren**.
3. **PHP:** **Erweitert** → **PHP-Konfiguration** → **PHP-Version** 8.3; unter **PHP-Erweiterungen** prüfen, dass `pdo_sqlite`, `sodium`, `mbstring` und `curl` aktiv sind.
4. **Zugang:** **Dateien** → **FTP-Konten** zeigt Server, Benutzer und den absoluten Pfad. Den **Dateimanager** kann man wie bei netcup zum Entpacken des ZIPs nutzen.
5. **Datenordner:** Die Website liegt unter `/home/u12345678/domains/<Hauptdomain>/public_html/`. Den Datenordner **neben** `public_html` anlegen: `/home/u12345678/domains/<Hauptdomain>/notion-data`. Liegt der App-Ordner innerhalb von `public_html`, nicht den relativen Pfad aus der FTP-Anleitung verwenden, er würde in `public_html` landen.
6. **Cron:** **Erweitert** → **Cron Jobs** → Typ **PHP**, Befehl ist der Pfad zur Datei, z. B. `/home/u12345678/domains/<Hauptdomain>/public_html/notizen/api/app/bin/cron.php`, alle 5 Minuten. [Hilfe](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/)
