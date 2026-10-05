# 0016 – Opt-in-Telemetrie

- **Status:** Proposed
- **Datum:** 2026-10-04

## Kontext

Wir wollen verstehen, wie die Software genutzt wird ([#103](https://github.com/mszkb/notion-alternative/issues/103)): welche Funktionen, welche Größenordnungen, welche Plattformen und welche Fehler. Das ADR klärt, was erfasst wird, wohin es geht und wie zugestimmt wird ([#104](https://github.com/mszkb/notion-alternative/issues/104)).

Vorgaben aus dem Epic:

- Opt-in statt Opt-out.
- Zwei Zustimmungen: Betreiber und Nutzer.
- Keine Inhalte und keine Identität.
- Geräte senden nie an Dritte, sondern nur an den eigenen Server.
- Höchstens eine Sendung pro Tag.
- Eine Vorschau des nächsten Payloads.
- Widerruf jederzeit.
- Zwei Container bleiben ([ADR 0006](0006-tech-stack.md)).

Betroffene Prinzipien aus `CLAUDE.md`:

- **Offline-first:** Telemetrie darf nie blockieren und nie auf dem Pfad einer Anfrage liegen.
- **Keine Feature-Sperren:** Wer ablehnt, behält alles.
- **Datensparsamkeit:** nur Daten, die eine konkrete Frage beantworten.

Heute gibt es kein Administratorkonto: Alle Konten sind gleichberechtigt. Betreiber ist, wer die Instanz konfiguriert (`.env`, Docker Compose).

## Optionen

### Empfänger

1. **Fester Dienst des Maintainers**, im Code hinterlegt.
   - **+** Kein Aufwand für Betreiber.
   - **−** Eine Domain und ein laufender Dienst müssen schon vor der ersten Version feststehen.
   - **−** Ein fest verdrahtetes Ziel wirkt bei Self-hosted-Software misstrauenserweckend.
2. **Konfigurierbares Ziel** über `TELEMETRY_ENDPOINT`.
   - **+** Betreiber können an einen eigenen Collector senden, z. B. für eine Firmeninstallation.
   - **+** Tests laufen gegen einen lokalen Empfänger.
   - **−** Ohne Standardwert muss der Betreiber das Ziel kennen.
3. **Beides:** konfigurierbar mit Standardwert des Maintainers.

### Zustimmung des Betreibers

1. **Nur Umgebungsvariable** `TELEMETRY_ENABLED`, Standard `false`.
   - **+** Eine bewusste Handlung, sichtbar in `.env`.
   - **+** Ein Update kann sie nicht setzen.
   - **+** Keine neue Rolle nötig.
   - **−** Ohne Zugriff auf den Host nicht umschaltbar.
2. **Schalter in der Oberfläche.**
   - **−** Braucht eine Administratorrolle, die es nicht gibt.
   - **−** Jeder Nutzer könnte für die ganze Instanz zustimmen.

### Zustimmung der Nutzer

1. **Schalter pro Konto, am Server gespeichert**, Standard aus. Er gilt für alle Geräte des Kontos und wird lokal zwischengespeichert, damit er offline gilt.
2. **Schalter pro Gerät.**
   - **−** Auf jedem Gerät erneut zu fragen.
   - **−** Der Widerruf muss auf jedem Gerät einzeln erfolgen.

### Kennung der Installation

1. **Keine Kennung.**
   - **+** Die Daten sind anonym, nicht nur pseudonym.
   - **+** Sendungen lassen sich nicht miteinander verknüpfen.
   - **−** Keine Verläufe pro Installation, etwa „wie lange bleiben Installationen aktiv“ oder „wie schnell wird aktualisiert“.
2. **Zufällige ID, monatlich rotiert.**
   - **+** Aktive Installationen pro Monat sind zählbar.
   - **−** Innerhalb eines Monats sind die Sendungen verknüpft, also pseudonym im Sinne der DSGVO.
3. **Stabile ID.**
   - **−** Dauerhaft pseudonym. Scheidet aus.

### Mengen

1. **Exakte Werte.**
   - **−** Ein Fingerabdruck einzelner Instanzen wird möglich, z. B. „genau 4 711 Seiten“.
2. **Größenklassen** für alle Mengen, auch für Tageszähler.
   - **+** Die Antworten bleiben grob, reichen aber für „wie groß, wie viel“.

## Entscheidung (Vorschlag)

**Empfänger:** Option 2, ein konfigurierbares Ziel.

- `TELEMETRY_ENDPOINT` hat keinen Standardwert, solange es keinen gehosteten Collector gibt ([#108](https://github.com/mszkb/notion-alternative/issues/108)).
- `TELEMETRY_ENABLED=true` ohne Endpunkt ist ein Konfigurationsfehler beim Start; es wird nicht still ignoriert.
- Steht der Dienst des Maintainers, wird seine Adresse Standardwert (Option 3). Das kommt mit eigenem Release-Hinweis und schaltet nichts ein: `TELEMETRY_ENABLED` bleibt `false`.
- Nur `https:`. Ausnahme: `http://localhost` bzw. `127.0.0.1` für Tests und eigene Collector auf demselben Host.

**Zustimmung:**

- **Betreiber:** Option 1, nur die Umgebungsvariable `TELEMETRY_ENABLED`, Standard `false`.
  - Ohne sie startet kein Job, es gibt keine Verbindung und keinen DNS-Lookup.
  - Der Endpunkt für Geräte antwortet dann mit `404`.
  - Ausschalten löscht beim nächsten Start alle gepufferten Zähler.
- **Nutzer:** Option 1, ein Schalter pro Konto, Standard aus.
  - Neues Feld am Konto, z. B. `users.telemetry_consent_at`, `null` = keine Zustimmung.
  - Der Widerruf löscht die lokalen Zähler auf dem Gerät und die gepufferten Zähler des Kontos auf dem Server.
- **Betreiber ja, Nutzer nein:**
  - Die Instanz sendet nur **Betriebsdaten**: Version, Plattform, Speicherart und Größenklassen der ganzen Instanz.
  - Nutzungszähler kommen nur von Konten mit Zustimmung.
  - Die Größenklassen der Instanz gehören zur Zustimmung des Betreibers. Sie sagen nichts über ein einzelnes Konto, solange die Instanz mehr als ein Konto hat.

**Keine Kennung (Option 1).**

- Jede Instanz sendet höchstens einmal pro Tag. Die Zahl der Sendungen pro Tag ist damit die Zahl der aktiven Installationen an diesem Tag.
- Mehr braucht die Auswertung vorerst nicht.
- Verläufe pro Installation sind bewusst nicht möglich. Wer sie später braucht, schreibt ein neues ADR.

**Anonymisierung:**

- Alle Mengen werden als **logarithmische Klassen** gesendet, auch Tageszähler: `0`, `1–9`, `10–99`, `100–999`, `1 000–9 999`, `≥ 10 000`.
- Der einzige Zeitbezug ist das Datum (UTC) des gezählten Tags, kein Sendezeitpunkt.
- **Nutzungszähler:** Der Server summiert sie über alle zustimmenden Konten und sendet nur die Summe. Ein Puffer pro Konto existiert nur lokal auf dem Server, damit ein Widerruf ihn löschen kann.
- **Keine Mindestzahl an Konten:** Die Hauptzielgruppe sind Einzelanwender. Dort sind Betreiber und Nutzer dieselbe Person und haben doppelt zugestimmt. Eine Mindestzahl würde die Nutzungszähler gerade bei ihnen immer unterdrücken. Ohne Kennung, ohne IP-Adresse und nur mit Klassen ist eine einzelne Instanz nicht wiedererkennbar.
- Alles nicht ausdrücklich Erlaubte ist ausgeschlossen. Das gilt besonders für:
  - Inhalte, Titel, Suchbegriffe, Dateinamen, E-Mail-Adressen und IP-Adressen;
  - Konto-, Workspace-, Seiten- und Geräte-IDs;
  - den User-Agent im Volltext;
  - Zeitpunkte genauer als ein Tag;
  - Fehlermeldungstexte (nur Fehlerklassen).

**Felder:**

- Der Payload hat ein festes zod-Schema in `@notion-alt/shared`. Es ist strikt: Unbekannte Felder werden abgelehnt, beim Senden wie beim Empfangen.
- Jedes Feld steht im Datenkatalog [`docs/privacy/telemetry.md`](../privacy/telemetry.md) ([#105](https://github.com/mszkb/notion-alternative/issues/105)).
- Ein neues Feld braucht einen Katalogeintrag und erhöht `schemaVersion`.

**Ablauf:**

- **Geräte:**
  - Sie zählen nur mit Zustimmung, pro Tag, in IndexedDB.
  - Sie senden mit dem nächsten Sync an `POST /api/telemetry/counters` des eigenen Servers, nie an Dritte.
  - Nach 7 Tagen ohne erfolgreiche Übertragung verwerfen sie die Zähler.
  - Der Service Worker zählt nicht.
- **Server:**
  - Er aggregiert pro Tag in SQLite.
  - Er sendet höchstens einmal pro Tag, mit einer Zufallsverzögerung von bis zu 6 Stunden nach Tageswechsel (UTC) und einem Timeout von 10 s.
  - Bei Fehlern verwirft er die Sendung ohne Wiederholung und löscht den Tag aus dem Puffer.
  - Der Puffer hält höchstens 7 Tage.
- **Vorschau:** `node dist/index.js telemetry-preview` gibt genau den Payload aus, den der nächste Versand senden würde. Sie verwendet dieselbe Funktion wie der Versand.

**Transport und Aufbewahrung beim Collector** ([#108](https://github.com/mszkb/notion-alternative/issues/108)):

- HTTPS.
- Keine IP-Adressen in Datenbank oder Logs. Das Rate-Limit läuft nur im Speicher.
- Rohdaten werden nach **90 Tagen** gelöscht. Danach bleiben nur Aggregate pro Woche, Version und Plattform.
- Die IP-Adresse ist beim Verbindungsaufbau technisch sichtbar, wird aber nicht gespeichert. So steht es auch im Datenschutzhinweis.

**Abhängigkeiten:** keine neue Bibliothek, kein Drittanbieter-SDK. Der Server nutzt `fetch` aus Node 22.

**Verhältnis zu `/api/metrics`:** getrennt. Die Prometheus-Metriken bleiben unverändert und nur für den Betreiber; die Telemetrie liest sie nicht aus.

## Konsequenzen

- Bei einer frischen Installation und nach jedem Update ist alles aus. Nur zwei bewusste Handlungen schalten Nutzungszähler ein.
- Ohne Kennung lassen sich keine Verläufe pro Installation auswerten, und Doppelzählungen sind nicht erkennbar. Da nie wiederholt wird, gibt es die praktisch nur bei Uhrfehlern.
- Größenklassen machen feine Trends unsichtbar, z. B. „+10 % Seiten“. Für die Fragen des Epics reicht das.
- **Folgeaufgaben:**
  - Datenkatalog ([#105](https://github.com/mszkb/notion-alternative/issues/105)).
  - Server ([#106](https://github.com/mszkb/notion-alternative/issues/106)): Konfiguration, Migration für Puffer und Zustimmung, Endpunkt, Versand, Vorschau.
  - Client ([#107](https://github.com/mszkb/notion-alternative/issues/107)): Schalter, Hinweis, Zähler, neue Dexie-Version.
  - Collector ([#108](https://github.com/mszkb/notion-alternative/issues/108)).
  - Tests T-TEL-01…07 ([#109](https://github.com/mszkb/notion-alternative/issues/109)).
- **Offene Punkte für die Annahme:**
  - Aufbewahrungsfrist beim Collector (Vorschlag 90 Tage).
  - Adresse des Maintainer-Dienstes.
  - Ob Fehlerklassen schon in der ersten Version dabei sind.
