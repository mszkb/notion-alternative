# Telemetrie: Datenkatalog und Datenschutzhinweis

> **Abgenommen am 2026-10-05 ([#105](https://github.com/mszkb/notion-alternative/issues/105)).** Gilt, sobald [ADR 0016](../adr/0016-opt-in-telemetry.md) angenommen ist. Bis dahin sendet die Software keinerlei Telemetrie, und die Funktion ist nicht eingebaut.

Die Telemetrie ist **aus**, solange nicht beide zustimmen:

1. **Der Betreiber der Instanz**, mit `TELEMETRY_ENABLED=true`. Nur dann sendet der Server überhaupt etwas, und zwar höchstens einmal pro Tag an `TELEMETRY_ENDPOINT`.
2. **Jeder Nutzer für sein Konto**, mit dem Schalter „Anonyme Nutzungsstatistik senden“ auf der Kontoseite. Nur dann zählen seine Geräte Nutzungsereignisse.

Stimmt nur der Betreiber zu, gehen ausschließlich die [Betriebsdaten](#betriebsdaten-server) hinaus. Geräte senden nie an Dritte, sondern nur an den eigenen Server. Wer ablehnt, kann alles weiter nutzen.

Dieser Katalog ist abschließend. Der Server sendet kein Feld, das hier nicht steht. Das zod-Schema des Payloads lehnt unbekannte Felder ab, ein Test prüft das (T-TEL-03).

## Größenklassen

Mengen werden nie exakt gesendet, sondern als Klasse:

| Klasse | Bedeutung |
| --- | --- |
| `0` | keine |
| `1-9` | 1 bis 9 |
| `10-99` | 10 bis 99 |
| `100-999` | 100 bis 999 |
| `1k-10k` | 1 000 bis 9 999 |
| `10k+` | 10 000 und mehr |

## Felder

### Rahmen

| Feld | Beispiel | Zweck | Quelle |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | Format des Payloads | Server |
| `day` | `2026-10-03` | Gezählter Tag (UTC). Kein Sendezeitpunkt, keine Uhrzeit. | Server |

Es gibt **keine** Kennung der Installation.

### Betriebsdaten (Server)

Werden gesendet, sobald der Betreiber zugestimmt hat.

| Feld | Beispiel | Zweck |
| --- | --- | --- |
| `appVersion` | `0.9.0` | Verbreitung von Versionen, Update-Verhalten |
| `arch` | `arm64` | Raspberry Pi vs. x86 (`amd64`, `arm64`, `other`) |
| `deployment` | `docker` | `docker` oder `other` |
| `nodeMajor` | `22` | Unterstützte Laufzeiten |
| `sqliteVersion` | `3.50` | Nur Major und Minor |
| `storage` | `volume` | Speicher für Anhänge: `volume` oder `s3` |
| `webPush` | `true` | Web Push konfiguriert (VAPID vorhanden) |
| `accounts` | `1-9` | Größenklasse: Konten |
| `workspaces` | `1-9` | Größenklasse: Workspaces |
| `pages` | `1k-10k` | Größenklasse: aktive Seiten |
| `blocks` | `10k+` | Größenklasse: aktive Blöcke |
| `attachments` | `10-99` | Größenklasse: Anhänge |
| `databaseMb` | `100-999` | Größenklasse: Datenbankgröße in MB |

### Nutzungszähler (Geräte, nur mit Zustimmung des Kontos)

Summe über alle zustimmenden Konten der Instanz, pro Tag, jeweils als Größenklasse. Ein Wert pro Konto wird nie gesendet.

| Feld | Beispiel | Zweck |
| --- | --- | --- |
| `consentingAccounts` | `1-9` | Wie viele Konten beitragen, zur Einordnung der Summen |
| `pagesCreated` | `10-99` | Aktivität |
| `syncRuns` | `100-999` | Sync-Häufigkeit |
| `resyncs` | `0` | Vollständige Re-Syncs (Hinweis auf Probleme) |
| `conflictsShown` | `1-9` | Wie oft Konflikte entstehen |
| `exports.markdown` / `exports.json` / `exports.zip` | `1-9` | Genutzte Exportformate |
| `imports` | `0` | Importe |
| `searches.local` / `searches.server` | `10-99` | Nutzung der Suche, ohne Suchbegriffe |
| `devices.browser.chromium` / `.firefox` / `.safari` / `.other` | `1-9` | Aktive Geräte nach Browserfamilie, aus dem User-Agent abgeleitet, nie im Volltext |
| `devices.installedPwa` | `1-9` | Aktive Geräte mit installierter App |
| `devices.mobile` / `devices.desktop` | `1-9` | Geräteklasse |

### Fehlerklassen (offen, siehe ADR)

Nur feste Kennungen mit Größenklasse, nie Meldungstexte oder Stacktraces, z. B. `errors.sync_push_failed`, `errors.quota_exceeded`, `errors.indexeddb_write_failed`.

## Ausdrücklich ausgeschlossen

Gesendet werden nie:

- Inhalte, Seitentitel, Blocktexte, Tag-Namen, Suchbegriffe, Dateinamen;
- E-Mail-Adressen und Namen;
- IP-Adressen: Der Empfänger sieht sie beim Verbindungsaufbau, speichert sie aber nicht;
- Konto-, Workspace-, Seiten-, Block-, Geräte- und Operations-IDs, überhaupt keine UUIDs;
- der User-Agent im Volltext;
- Zeitpunkte genauer als ein Tag;
- Fehlermeldungstexte;
- exakte Mengen.

## Speicherung und Löschung

- **Gerät:** Tageszähler in IndexedDB, nur mit Zustimmung. Sie werden gelöscht, sobald der eigene Server sie angenommen hat, spätestens nach 7 Tagen.
- **Eigener Server:** Tagespuffer pro Konto in SQLite, damit ein Widerruf ihn löschen kann. Er wird nach dem Versand gelöscht, spätestens nach 7 Tagen. `TELEMETRY_ENABLED=false` löscht alle Puffer beim nächsten Start.
- **Empfänger** (Collector des Maintainers oder ein eigener): keine IP-Adressen in Datenbank oder Logs. Rohdaten werden nach 90 Tagen gelöscht, danach bleiben nur Aggregate pro Woche, Version und Plattform.

## Hinweistexte

**Schalter auf der Kontoseite:**

> **Anonyme Nutzungsstatistik senden**
> Zählt auf deinen Geräten grob, welche Funktionen du nutzt (z. B. „10–99 Syncs am Tag“), ohne Inhalte, Titel, Suchbegriffe oder Kennungen. Die Zähler gehen an diesen Server, der sie mit anderen zusammenfasst. Du kannst die Zustimmung jederzeit zurücknehmen; die gezählten Daten werden dann gelöscht. [Was genau erfasst wird](…/docs/privacy/telemetry.md)

**Einmaliger Hinweis**, nur wenn der Betreiber die Telemetrie aktiviert hat. Beide Knöpfe sind gleich groß und gleich auffällig:

> Der Betreiber dieser Instanz sammelt anonyme Nutzungsstatistiken, um die Software zu verbessern. Möchtest du mit deinen Geräten beitragen? Es werden keine Inhalte oder Kennungen erfasst. [Details](…/docs/privacy/telemetry.md)
>
> [Nein, danke] [Ja, beitragen]

## Für Betreiber

Ein- und Ausschalten sowie die Vorschau des nächsten Payloads beschreibt [`deployment.md`](../operations/deployment.md), sobald die Funktion eingebaut ist ([#106](https://github.com/mszkb/notion-alternative/issues/106)).
