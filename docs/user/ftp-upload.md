# Hochladen per FTP

Schritt für Schritt: das Release-ZIP mit einem FTP-Programm auf den Webspace bringen, ohne Kommandozeile. Die Voraussetzungen und den Überblick beschreibt [Installation auf Webspace](webhosting.md), die Einstellungen bei den einzelnen Hostern [Einrichtung bei Hostern](hoster.md).

## Was du brauchst

- das Release-ZIP `notion-alt-php-<Version>.zip`, entpackt auf deinem Rechner
- die FTP-Zugangsdaten aus dem Kundenmenü des Hosters: Server (Host), Benutzername, Passwort, Port
- ein FTP-Programm, z. B. [FileZilla](https://filezilla-project.org/) (Windows, macOS, Linux; nur den „Client“, und beim Installieren angebotene Zusatzsoftware abwählen) oder [Cyberduck](https://cyberduck.io/) (Windows, macOS)
- einen einfachen Texteditor für die Konfiguration: Editor (Windows), TextEdit im Modus „Reiner Text“ (macOS) oder z. B. VS Code. Kein Word oder LibreOffice, die schreiben Formatierungen in die Datei.

## 1. Verbindung herstellen

Wenn der Hoster es anbietet, **SFTP** statt FTP nehmen: Bei SFTP gehen Passwort und Dateien verschlüsselt über die Leitung. Geht nur FTP, dann „FTP über TLS“ (FTPS) wählen; unverschlüsseltes FTP nur, wenn nichts anderes möglich ist.

In FileZilla: **Datei → Servermanager → Neuer Server**

| Feld | Eintrag |
| --- | --- |
| Protokoll | `SFTP – SSH File Transfer Protocol` (Port 22) oder `FTP` mit „Explizites FTP über TLS erfordern“ (Port 21) |
| Server | aus dem Kundenmenü, z. B. `ssh.strato.de` oder `w0123456.kasserver.com` |
| Verbindungsart | Normal |
| Benutzer, Passwort | aus dem Kundenmenü |

Beim ersten Verbinden fragt FileZilla nach dem Fingerabdruck des Servers. Wenn der Hoster ihn im Kundenmenü oder in seiner Hilfe angibt, vergleichen und dann bestätigen.

Links siehst du die Ordner deines Rechners, rechts die des Webspace.

**Versteckte Dateien anzeigen:** Die Dateien `.htaccess` beginnen mit einem Punkt und werden sonst leicht übersehen. In FileZilla: **Server → Anzeige versteckter Dateien erzwingen**. Unter macOS im Finder `⌘ + ⇧ + .`, damit sie auch links erscheinen.

## 2. Ordner anlegen

Auf dem Webspace (rechte Seite) zwei Ordner anlegen (Rechtsklick → **Verzeichnis erstellen**):

```text
/                      ← Startordner nach dem Login
├── notizen/           ← hierhin kommt die App, die (Sub-)Domain zeigt auf diesen Ordner
└── notion-data/       ← Datenbank und Anhänge, auf diesen Ordner zeigt keine Domain
```

Die Namen sind frei wählbar. Wichtig:

- Die App braucht einen eigenen Ordner, auf den die (Sub-)Domain zeigt, z. B. `notizen.example.de` → `/notizen`. Wie man das einstellt, steht bei den [Hostern](hoster.md).
- Der Datenordner darf über **keine** Domain erreichbar sein. Zeigt deine Hauptdomain auf den Startordner `/` selbst, wäre `https://example.de/notion-data/` öffentlich. Dann die Hauptdomain auf einen Unterordner umstellen oder den Datenordner woanders anlegen (siehe Hoster). Zusätzlich schützt die Datei aus Schritt 4.

## 3. Dateien hochladen

1. Links in den entpackten Ordner `notion-alt/` wechseln, rechts in `notizen/`.
2. Links **alles in `notion-alt/` markieren** (`Strg + A` bzw. `⌘ + A`), also `index.html`, `assets/`, `api/`, `.htaccess` usw., nicht den Ordner `notion-alt` selbst.
3. Auf die rechte Seite ziehen. Fragt FileZilla wegen vorhandener Dateien, **Überschreiben** wählen.
4. Warten, bis unten „Zu übertragende Dateien“ leer ist und unter **Fehlgeschlagene Übertragungen** nichts steht. Steht dort etwas: Rechtsklick → **Alle zurücksetzen und erneut in Warteschlange stellen**, dann `Strg + P` (Warteschlange abarbeiten).

Danach sieht es auf dem Webspace so aus:

```text
notizen/
├── .htaccess
├── index.html
├── assets/
├── app-icons/
└── api/
    ├── .htaccess
    ├── index.php
    ├── check.php
    └── app/
        ├── .htaccess
        ├── config.example.php
        ├── bin/
        ├── src/
        └── vendor/
```

Fehlt eine der drei `.htaccess`, wurde sie nicht mit hochgeladen (versteckte Dateien, siehe oben).

Das Hochladen dauert je nach Leitung einige Minuten, weil `api/app/vendor/` aus vielen kleinen Dateien besteht. **Schneller:** Bietet der Hoster einen Dateimanager mit „Entpacken“ (z. B. Plesk bei netcup, hPanel bei Hostinger), das ZIP selbst hochladen, dort entpacken und den Inhalt von `notion-alt/` in den App-Ordner verschieben.

## 4. Datenordner schützen

Im Datenordner `notion-data/` eine Datei `.htaccess` mit diesem Inhalt anlegen (in FileZilla: Rechtsklick → **Neue Datei erstellen**, dann Rechtsklick → **Ansehen/Bearbeiten**):

```apache
Require all denied
```

Sie sperrt den Ordner, falls doch einmal eine Domain darauf zeigt. Ersetzt nicht den Ordner außerhalb jeder Domain, ist aber eine zweite Sicherung.

## 5. Konfiguration anlegen

1. `notizen/api/app/config.example.php` auf deinen Rechner herunterladen (Rechtsklick → **Herunterladen**).
2. Im Texteditor öffnen und als `config.php` speichern.
3. Den Pfad zum Datenordner eintragen:

   ```php
   'DATA_DIR' => '/absoluter/pfad/zu/notion-data',
   ```

   Den absoluten Pfad nennt der Hoster im Kundenmenü (oft „Webspace-Pfad“, „Pfad“ oder „Document Root“, siehe [Hoster](hoster.md)). Die Pfade, die FileZilla oben rechts anzeigt (`/notion-data`), sind **nicht** die absoluten Pfade auf dem Server.

   Ohne absoluten Pfad geht auch ein relativer, gerechnet vom Ordner `api/app/` aus. Liegen `notizen/` und `notion-data/` wie oben nebeneinander:

   ```php
   'DATA_DIR' => '../../../notion-data',
   ```

4. Die übrigen Werte: `COOKIE_SECURE` bleibt `true`, `ALLOW_REGISTRATION` bleibt vorerst `true`, `PUSH_SUBJECT` auf deine E-Mail-Adresse (`mailto:du@example.de`).
5. Speichern und die `config.php` nach `notizen/api/app/` hochladen.

Achte beim Bearbeiten darauf, dass die Anführungszeichen gerade sind (`'`, nicht `‘` oder `’`) und jede Zeile mit einem Komma endet. Ein Fehler hier ergibt in Schritt 7 „Konfiguration gültig ❌“.

## 6. Rechte prüfen

Bei den meisten Hostern passen die Rechte nach dem Hochladen. Nur wenn der Einrichtungs-Check in Schritt 7 „Datenverzeichnis beschreibbar ❌“ meldet: In FileZilla Rechtsklick auf `notion-data` → **Dateiberechtigungen** → Zahlenwert `750` (geht das nicht, `770`). Nie `777`.

Dateien brauchen `644`, Ordner `755`; so legt FileZilla sie in der Regel an.

## 7. Einrichtung prüfen und abschließen

1. `https://notizen.example.de/api/check.php` im Browser öffnen. Sind alle Punkte grün, `notizen/api/check.php` per FTP **löschen**.
2. `https://notizen.example.de/` öffnen und das erste Konto registrieren.
3. `config.php` noch einmal herunterladen, `ALLOW_REGISTRATION` auf `false` setzen, wieder hochladen.
4. Den Cron-Eintrag anlegen, falls der Hoster ihn anbietet (siehe [Hoster](hoster.md)).

## Update per FTP

1. Vorher sichern: in der App **Export** ([Export und Import](export.md)) und den Ordner `notion-data/` herunterladen, während niemand die App benutzt.
2. Das neue ZIP entpacken und den Inhalt von `notion-alt/` wie in Schritt 3 hochladen, alles überschreiben. `config.php` ist im ZIP nicht enthalten und bleibt erhalten.
3. `notizen/api/check.php` wieder löschen; das neue ZIP bringt die Datei mit.
4. Hast du `notizen/.htaccess` von Hand ergänzt (z. B. die PHP-Version bei STRATO), die Ergänzung wieder eintragen. Das Update überschreibt die Datei.

Dateien, die es in der neuen Version nicht mehr gibt, bleiben liegen. Das schadet nicht. Wer aufräumen will, löscht vor dem Hochladen `notizen/assets/` und `notizen/api/app/vendor/`, `src/`, `bin/` (nie `config.php`); die App ist dann für die Dauer des Hochladens nicht erreichbar.

## Häufige Fehler

| Anzeige | Ursache und Abhilfe |
| --- | --- |
| Startseite geht, aber beim Neuladen einer Unterseite kommt „404 Not Found“ | `notizen/.htaccess` fehlt oder `mod_rewrite` ist aus. Datei hochladen (versteckte Dateien anzeigen), sonst Hoster fragen. |
| „500 Internal Server Error“ auf allen Seiten | Der Server kennt eine Anweisung aus der `.htaccess` nicht, meist `mod_headers`. Hoster fragen; das Fehlerprotokoll im Kundenmenü nennt die Zeile. |
| `api/check.php` zeigt PHP-Quelltext oder lädt eine Datei herunter | PHP ist für den Ordner nicht aktiv. PHP-Version im Kundenmenü einstellen. |
| `api/check.php` zeigt eine leere Seite oder „500“ | PHP älter als 8.2, `vendor/` unvollständig oder ein Tippfehler in `config.php`. PHP-Version umstellen, fehlgeschlagene Übertragungen wiederholen, `config.php` prüfen (Schritt 5). |
| „Konfiguration gültig ❌“ | Tippfehler in `config.php`, siehe Schritt 5. Mit `config.example.php` vergleichen. |
| „Datenverzeichnis außerhalb des Webroots ❌“ | `DATA_DIR` zeigt in den App-Ordner. Ordner nach Schritt 2 anlegen. |
| Anmelden klappt, aber man ist sofort wieder abgemeldet | Seite über `http://` aufgerufen, `COOKIE_SECURE` verlangt `https://`. HTTPS beim Hoster aktivieren und die `https://`-Adresse benutzen. |
| Hochladen großer Anhänge schlägt fehl | Das PHP-Limit für Uploads (`upload_max_filesize`, `post_max_size`) des Hosters ist kleiner als `ATTACHMENT_MAX_MB` (25 MB). In den PHP-Einstellungen des Hosters erhöhen. |
