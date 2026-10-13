# 0024 – MariaDB und MySQL als Option neben SQLite

- **Status:** Proposed
- **Datum:** 2026-10-13

## Kontext

Der Server speichert alles in einer SQLite-Datei ([ADR 0006](0006-tech-stack.md), [ADR 0018](0018-php-backend.md)). Der Maintainer möchte MariaDB und MySQL als **Option** anbieten. Es gibt Webhoster, bei denen eine verwaltete Datenbank der vorgesehene Weg ist. In den Kundenmenüs heißt sie oft einfach „MySQL-Datenbank“, auch wenn dahinter MariaDB läuft; Nutzer wissen meist nicht, welche der beiden sie haben. Und manche Shared Hoster legen Dateien auf Netzlaufwerken ab, wo SQLite im WAL-Modus unzuverlässig ist. SQLite bleibt der Standard, weil es kein Setup braucht ([`vision.md`](../product/vision.md), „Einfachheit und minimales Setup“).

Stand heute:

- **Abfragen:** 133 PHP-Dateien mit etwa 10.600 Zeilen. Abfragen sind handgeschriebenes SQL über die Hilfsklasse `Sql` (133 Aufrufe), es gibt kein ORM.
- **Migrationen:** 17 Migrationen in SQLite-Syntax (`apps/server/src/Database/Migrations/`). Migrationen werden nie nachträglich geändert. Der Migrationsstand steht in `kysely_migration`.
- **SQLite-eigene Stellen:**
  - `pragma` (WAL, Fremdschlüssel, Wartezeit) in `Database::open`.
  - `begin immediate` in `Transaction.php`, `Metrics.php` und `Migrator.php`.
  - Upserts mit `on conflict … do` bzw. `insert or ignore` an etwa 10 Stellen.
  - `rowid` in `SearchIndex.php` und `Metrics.php`.
  - Volltextsuche mit FTS5 (`bm25`, `snippet`; Migrationen 0005 und 0009, `SearchIndex.php`).
- **Reihenfolge im Änderungslog:** `Apply::nextSeq` vergibt die Sync-Nummer als `max(seq) + 1` je Workspace (`apps/server/src/Sync/Apply.php:754`). Das ist korrekt, weil `begin immediate` alle Schreiber nacheinander abarbeitet. Der Delta-Pull verlässt sich darauf: Eine Änderung mit kleinerer `seq` ist nie später sichtbar als eine mit größerer.
- **Backup und Restore:** `bin/console backup|restore` kopiert die SQLite-Datei samt Anhängen. `scripts/backup-restore-test.sh` prüft das.
- **Abhängigkeiten:** nur `slim/slim` und `slim/psr7`. Neue Composer-Pakete dürfen keine C-Erweiterungen brauchen (Webspace) und müssen auf `linux/arm64` bauen.

Betroffene Prinzipien und Invarianten:

- **Minimales Setup:** SQLite bleibt der Weg ohne Konfiguration. MariaDB und MySQL sind eine zusätzliche Wahl, nie eine Voraussetzung. Im Folgenden steht „MariaDB/MySQL“ für beide.
- **Sync-Invarianten** (`CLAUDE.md`): idempotente Operationen, Tombstones, Delta-Sync über Cursor und ein jederzeit möglicher Re-Sync gelten auf beiden Datenbanken gleich.
- **Contract-Tests sind die Spezifikation** (ADR 0018): Derselbe Testlauf muss gegen beide Datenbanken grün sein.

## Optionen

### A. Datenbankzugriff

1. **Volles ORM (Doctrine ORM oder Eloquent)**
   - **+** Entitäten und Abfragen unabhängig von der Datenbank.
   - **−** Der ganze Server müsste umgebaut werden: Entitäten, Mappings, Repositories für alle 10.600 Zeilen.
   - **−** Ausgerechnet die schwierigen Teile löst es nicht: Volltextsuche, Sperre für die Sync-Reihenfolge, Upserts und Backup brauchen weiter eigenes SQL je Datenbank.
   - **−** Mit Abstand die größte Abhängigkeit im Release-ZIP.
2. **Doctrine DBAL (Datenbankschicht ohne ORM)**
   - **+** Eine Verbindung für SQLite, MariaDB und MySQL über PDO, reines PHP ohne C-Erweiterung. Beim Hoster braucht es nur `pdo_sqlite` bzw. `pdo_mysql`.
   - **+** Schema-API: Tabellen, Spaltentypen und Indexe werden einmal beschrieben, DBAL erzeugt das passende SQL für jede Datenbank.
   - **+** Das bestehende SQL läuft fast unverändert weiter. `Sql` bekommt die DBAL-Verbindung statt PDO.
   - **+** Die Datenbank-Plattform ist abfragbar, so lässt sich je Datenbank verzweigen, wo es nötig ist.
   - **−** Eine neue Abhängigkeit, die drei kleine Pakete mitbringt (`doctrine/deprecations`, `psr/cache`, `psr/log`).
   - **−** Volltextsuche, Upserts und Sperren bleiben eigene Arbeit.
3. **Eigene Dialektschicht in `Sql`, ohne neue Abhängigkeit**
   - **+** Das Release-ZIP bleibt so schlank wie heute.
   - **−** Das Schema muss doppelt gepflegt werden, einmal je Datenbank, für jede künftige Migration.
   - **−** Unterschiede bei Typen und Indexen fallen erst in den Tests auf. Etwa 2 bis 3 Tage mehr Aufwand, fehleranfälliger.

### B. Reihenfolge der Sync-Nummern auf MariaDB/MySQL

1. **Sperre auf die Zeile des Workspace:** `select … from workspaces where id = ? for update` vor `nextSeq`, gehalten bis zum Ende der Transaktion.
   - **+** Schreiber im selben Workspace laufen nacheinander. Die `seq` steigt in der Reihenfolge, in der die Transaktionen fertig werden, wie bei SQLite.
   - **+** Verschiedene Workspaces sperren sich gegenseitig nicht.
   - **−** Wartezeit bei vielen gleichzeitigen Pushes in denselben Workspace. Das ist dasselbe Verhalten wie heute bei SQLite, wo sogar alle Workspaces warten.
2. **Globale Sperre** (`GET_LOCK`): einfacher, bremst aber unnötig auch fremde Workspaces.
3. **Pull nur bis zur kleinsten offenen `seq`:** braucht eine Liste laufender Transaktionen und ist komplex. Nicht nötig, solange 1 reicht.

### C. Volltextsuche auf MariaDB/MySQL

1. **InnoDB `FULLTEXT` mit `MATCH … AGAINST` im Boolean-Modus**
   - Präfixsuche mit `term*`, Ausschnitte (Snippets) werden in PHP gebildet.
   - **−** Unterschiede zu FTS5:
     - Wörter unter 3 Zeichen findet die Suche nicht (`innodb_ft_min_token_size`); das lässt sich auf Shared Hosting nicht ändern.
     - Stoppwörter.
     - Eine andere Gewichtung der Treffer.
2. **Suchindex in PHP** (eigene Token-Tabelle): gleiches Verhalten auf beiden Datenbanken, aber deutlich mehr Code und langsamer.

### D. Backup, Restore und Umzug

1. **Ein Backup-Format für beide:** `bin/console backup` schreibt immer eine SQLite-Datei (bei MariaDB/MySQL durch Kopieren der Tabellen) samt Anhängen.
   - **+** `restore` spielt diese Datei in die konfigurierte Datenbank ein. Damit ist der Umzug SQLite ↔ MariaDB/MySQL derselbe Befehl, und `scripts/backup-restore-test.sh` prüft beide Richtungen.
   - **+** Es braucht keinen Zugriff auf `mysqldump`, den es auf Webspace oft nicht gibt.
   - **−** Große Datenbanken brauchen beim Backup Platz für die SQLite-Kopie.
2. **`mysqldump` bzw. `mariadb-dump`:** Das ist das übliche Werkzeug, auf Webspace aber oft nicht verfügbar. Außerdem gäbe es dann zwei Backup-Formate.

## Entscheidung

Vorschlag, Annahme durch den Maintainer steht aus: **A2, B1, C1, D1.**

### Datenbankzugriff und Konfiguration

- `doctrine/dbal` in der aktuellen Hauptversion (4.x) wird die einzige neue Abhängigkeit. Die Versionsnummer wird bei der Umsetzung festgelegt.
- Ohne Angabe läuft die App wie heute auf SQLite (`DATA_DIR` bzw. `DATABASE_PATH`).
- Mit `DATABASE_URL=mysql://user:passwort@host:3306/datenbank` läuft sie auf MariaDB bzw. MySQL. Für Webspace stehen in `config.php` die Felder `DB_HOST`, `DB_NAME`, `DB_USER` und `DB_PASSWORD`.
- Unterstützt werden **MariaDB ab 10.11** und **MySQL ab 8.4**, jeweils die ältesten noch gepflegten Versionen mit Langzeit-Support. MariaDB 10.6 ist seit Juli 2026 ohne Support, MySQL 8.0 seit April 2026. MySQL 8.0 dürfte mit denselben Funktionen laufen, wird aber nicht getestet.
- Beide sprechen dasselbe Protokoll über `pdo_mysql`, und DBAL hat für jede eine eigene Plattform. Im eigenen SQL gilt: nur, was beide können.
  - Upserts mit `on duplicate key update spalte = values(spalte)`. Die neuere MySQL-Form `… as new` kennt MariaDB nicht.
  - Kein `returning` (gibt es nur in MariaDB).
  - JSON als Text, nicht als eigener Typ.
- Tabellen auf MariaDB/MySQL: InnoDB, `utf8mb4`, Sortierung `utf8mb4_bin` (die Standards beider unterscheiden sich, daher ausdrücklich). So vergleichen beide wie SQLite mit `=` genau, auch bei Groß- und Kleinschreibung (Tag-Namen, eindeutige Schlüssel). E-Mail-Adressen speichert der Server schon heute kleingeschrieben (`Users.php`).
- Texte, die lang werden können, bekommen `MEDIUMTEXT`: Blockinhalt bis 100.000 Zeichen, die Nutzdaten (`payload`) im Änderungslog und das JSON von Importen.

### Schema und Migrationen

- **SQLite:** Die bestehenden Migrationen 0001 bis 0017 bleiben, wie sie sind.
- **MariaDB/MySQL:** Sie bekommen **eine gemeinsame Basis-Migration**, die genau dem Stand nach 0017 entspricht. Sie wird mit der DBAL-Schema-API geschrieben und in `kysely_migration` als 0001 bis 0017 eingetragen, damit der Migrationsstand auf beiden Datenbanken gleich zählt.
- **Ab Migration 0018** wird jede Schema-Änderung einmal mit der DBAL-Schema-API geschrieben und gilt für beide Datenbanken. SQLite-eigene Teile (FTS5) bzw. MariaDB/MySQL-eigene Teile (`FULLTEXT`) verzweigen nach der Plattform.
- `MigratorTest` prüft, dass das Schema nach allen Migrationen auf beiden Datenbanken dieselben Tabellen, Spalten (bis auf den Typnamen), Indexe und Fremdschlüssel hat.

### Transaktionen und Sync

- `Transaction::run` beginnt auf SQLite weiter mit `begin immediate`, auf MariaDB/MySQL mit `START TRANSACTION`.
- Auf MariaDB/MySQL sperrt `Apply` vor der ersten Operation eines Workspace dessen Zeile mit `for update` (B1). `Metrics` und `Migrator` bekommen eigene Sperren: `for update` auf ihrer Zeile bzw. `GET_LOCK('notion-alt-migrate')`.
- Die Savepoints je Operation (#95) funktionieren auf InnoDB unverändert.
- Ein Deadlock (Fehler 1213, bei beiden gleich) wiederholt die ganze Transaktion einmal. Ein Batch ist idempotent (`op_id`), daher ist das sicher.
- Upserts gehen über eine Methode in `Sql` mit dem jeweiligen Dialekt: `on conflict … do update` bzw. `on duplicate key update` oder `insert ignore`.
- `rowid` wird durch eigene Schlüsselspalten ersetzt, auf SQLite weiter als `rowid`-Alias (`integer primary key`).

### Suche

- MariaDB/MySQL nutzen `FULLTEXT` (C1). Die Stoppwortlisten beider unterscheiden sich leicht. Die Unterschiede werden dokumentiert:
  - Wörter mit 1 bis 2 Zeichen findet nur die lokale Suche im Client, die ohnehin zuerst läuft und für alle Geräte gilt.
  - Die Gewichtung der Treffer ist anders.
- Die Contract-Tests der Suche prüfen nur, was beide Datenbanken garantieren: Treffer, Rechte, Präfix ab 3 Zeichen und keine fremden Workspaces.
- Was nur FTS5 kann, testet PHPUnit nur auf SQLite.

### Backup, Restore, Umzug

- `backup` schreibt immer eine SQLite-Datei samt Anhängen (D1).
- `restore` spielt sie in die konfigurierte Datenbank ein.
- `bin/console db:copy` überträgt die Daten zwischen zwei Konfigurationen, z. B. von SQLite nach MariaDB oder MySQL. Es ist derselbe Code wie bei `restore`.
- Doku und `scripts/backup-restore-test.sh` werden für beide Datenbanken angepasst.

### Betrieb, Tests, CI

- **Docker Compose** bleibt bei zwei Containern ([ADR 0010](0010-reference-deployment-and-https.md)). MariaDB/MySQL wird als vorhandene Datenbank über `DATABASE_URL` angebunden. Die Doku zeigt ein Beispiel mit einem eigenen MariaDB-Container außerhalb dieses Stacks.
- **Webspace:** `check.php` prüft je nach Konfiguration `pdo_sqlite` mit FTS5 oder `pdo_mysql`, die Verbindung und welche Datenbank in welcher Version tatsächlich läuft.
- **CI:** PHPUnit, Contract-Tests und der Backup-Test laufen gegen SQLite **und** gegen MariaDB 10.11 und MySQL 8.4 (als Service-Container).

## Konsequenzen

- **Abhängigkeit:** Eine neue Abhängigkeit (`doctrine/dbal`). ADR 0007 und ADR 0018 werden um diesen Eintrag ergänzt, sobald dieses ADR angenommen ist.
- **Testaufwand:** Jede Änderung am Server läuft gegen zwei Datenbanken. Neue SQL-Stellen müssen beide Dialekte bedienen oder die DBAL-API nutzen. `CLAUDE.md` erhält dafür einen Hinweis.
- **Suche:** Auf MariaDB/MySQL findet die Suche keine Wörter unter 3 Zeichen und gewichtet Treffer anders. Die Nutzerdoku sagt das.
- **Setup:** SQLite bleibt der Weg ohne Einrichtung, die Landing Page wirbt weiter mit „nur PHP nötig“. MariaDB/MySQL erscheint dort als Option für Hoster, die eine Datenbank mitbringen.
- **Aufwand** (geschätzt, etwa 12 bis 17 Personentage):

  | Bereich | Aufwand |
  | --- | --- |
  | DBAL-Grundlage, Konfiguration | 1 Tag |
  | Basis-Schema und Migrationen für MariaDB/MySQL | 2–3 Tage |
  | Dialekt (Upserts, `rowid`, Transaktionen) | 1 Tag |
  | Suche mit `FULLTEXT` | 2–3 Tage |
  | Sperre für die Sync-Reihenfolge mit Tests unter Last | 1–2 Tage |
  | Backup, Restore, `db:copy` | 1–2 Tage |
  | CI für drei Datenbanken (SQLite, MariaDB, MySQL), Upsert-Syntax für beide, Prüfseite, Doku | 3–5 Tage |

- **Folgeaufgaben** (Issues nach der Annahme):
  1. DBAL-Grundlage und Konfiguration.
  2. Basis-Schema für MariaDB/MySQL und Schema-Vergleich im `MigratorTest`.
  3. Dialekt für Upserts und Transaktionen.
  4. Sperre für die Sync-Reihenfolge, mit einem Lasttest für gleichzeitige Pushes in denselben Workspace.
  5. Suche mit `FULLTEXT`.
  6. Backup, Restore und `db:copy`.
  7. CI für SQLite, MariaDB und MySQL.
  8. `check.php` und Webspace-Doku.
  9. Landing Page und Nutzerdoku.

### Offen für den Maintainer

- Ist die Grenze bei MariaDB 10.11 und MySQL 8.4 richtig, oder müssen ältere Hoster-Versionen (MariaDB 10.6, MySQL 8.0) mit?
- Sollen Wörter unter 3 Zeichen auf MariaDB/MySQL zusätzlich über eine `LIKE`-Suche gefunden werden? Das wäre langsamer, verhielte sich aber wie FTS5.
