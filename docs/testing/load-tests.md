# Lasttests

Belastbarkeit großer Workspaces ([#77](https://github.com/mszkb/notion-alternative/issues/77)). Die Skripte sind reproduzierbar: fester Zufalls-Seed für die Inhalte und keine zusätzlichen Abhängigkeiten. Das Server-Skript läuft mit reinem Node 22 und damit auch direkt auf einem Raspberry Pi.

## Skripte

| Was | Befehl | Misst |
| --- | --- | --- |
| Server | `node scripts/loadtest/server-load.mjs` (startet den PHP-Server mit `php -S`) | Seed per Sync-Push (volle Batches à 500 Operationen), mehrere Geräte gleichzeitig (Push + Delta-Pull), vollständiger Pull, Snapshot seitenweise (Re-Sync, #97), Änderungslog (JSON-Export), Serversuche; RAM/CPU des Serverprozesses |
| Client (Chromium) | `pnpm --filter @notion-alt/web loadtest:browser` | Snapshot seitenweise in die lokale Datenbank schreiben (neues Gerät/Re-Sync), Seitenliste, Blöcke einer Seite, Aufbau, Speichern und Laden des Suchindex (MiniSearch, #98), Suchanfragen, JS-Heap |
| App (Chromium, [#96](https://github.com/mszkb/notion-alternative/issues/96)) | `LOAD_PAGES=1000 pnpm --filter @notion-alt/web exec playwright test e2e/load-app.spec.ts --project chromium` | Die echte App gegen einen echten Server: Seed über ein zweites Gerät; Erstsync als neues Gerät bis „Synchronisiert um“; Kaltstart aus IndexedDB, bis der Seitenbaum sichtbar ist; Öffnen einer Seite mit `LOAD_BIG_BLOCKS` (2 000) Blöcken; Tippen am Ende dieser Seite. Ohne `LOAD_PAGES` wird der Test übersprungen, auch in der CI. Optionen siehe unten. |
| Client (Node) | `pnpm --filter @notion-alt/web loadtest` | Dasselbe Szenario mit fake-indexeddb. Nur für schnelle Vergleiche: Die IndexedDB-Zeiten sind dort viel zu hoch, weil Index-Cursor quadratisch laufen (10 000 Zeilen per `anyOf`: 51 s statt 0,5 s). |

**Parameter** (Umgebungsvariablen):

- `PAGES` (Standard: Server und Chromium 1 000, Node 200) und `BLOCKS_PER_PAGE` (50).
- Nur Server: `DEVICES` (10), `ROUNDS` (20), `OPS_PER_ROUND` (50), `SEARCHES` (50), `SNAPSHOT_PAGE` (2 000). `LEGACY_SNAPSHOT=1` misst zusätzlich den alten Snapshot in einer Antwort.
- `OUT=datei.json` speichert das Ergebnis.
- Nur App (`load-app.spec.ts`):
  - `LOAD_PREVIEW=1` misst den Production-Build (`vite preview`) statt des Entwicklungsservers. Im Entwicklungsmodus prüft Vue zusätzlich Props und baut pro Komponente einen Entwicklungskontext auf; das kostet beim Kaltstart mit 10 000 Baumknoten rund 0,7 s. Die Zahlen in diesem Dokument ab #102 stammen aus dem Production-Build.
  - `LOAD_BLOCKS_PER_PAGE` (50): Mit `1` dauern Seed und Erstsync bei 10 000 Seiten nur Sekunden. Das reicht, wenn es nur um den Seitenbaum geht.
  - `PROFILE_DIR=…` schreibt CPU-Profile von Erstsync, Kaltstart, Öffnen der großen Seite und Tippen; `TRACE_DIR=…` schreibt Chrome-Traces derselben Schritte (Layout, Style, GC). Beide verlängern die gemessenen Zeiten spürbar, für Zahlen ohne sie messen.
  - Das Playwright-Tracing ist in diesem Test ausgeschaltet. Es hat nach jeder Aktion den ganzen DOM abgelaufen (10 000 Baumknoten, 2 000 Blöcke) und rund 1 s pro Schritt in die Messung getragen, beim Tippen etwa 14 ms pro Taste.

**Ziele:**

- Ohne `BASE_URL` startet das Server-Skript den PHP-Server (`php -S` mit 8 Workern) mit einer temporären Datenbank und misst RAM/CPU des Hauptprozesses über `/proc`. Die Messwerte unten stammen noch vom Node-Server (bis #129); für PHP-FPM unter Last steht eine neue Messung aus.
- Mit `BASE_URL=http://127.0.0.1:3000` nimmt es einen laufenden Server. Den RAM liest es dann aus `/api/metrics`, wenn `METRICS_ENABLED=true` ist und der Endpunkt erreichbar ist.
- Gegen eine produktive Instanz nur mit `ALLOW_REGISTRATION=true` und auf eigene Gefahr. Das Skript legt ein Konto mit großem Workspace an.

Die Zielgröße aus dem Issue ist `PAGES=10000`, also 10 000 Seiten und 500 000 Blöcke.

## Ergebnisse (2026-10-03)

**Testumgebung:** Cloud-Container mit 4 vCPU (Xeon, 2,1 GHz) und 16 GB RAM, Node 22.22, Chromium 141 headless. Ein Raspberry Pi 4 ist grob um den Faktor 3–4 langsamer. Messungen dort stehen noch aus.

### Server, 10 000 Seiten / 500 000 Blöcke

Gemessen am 2026-10-04 nach #95 (Push-Batch in einer Transaktion) und #97 (seitenweiser Snapshot).

| Szenario | Ergebnis |
| --- | --- |
| Seed: 510 000 Operationen in 1 020 Pushes à 500 | **3 149 Ops/s** über den ganzen Lauf (vor #95: 1 128); Push à 500: p50 160 ms, p95 189 ms, max 248 ms; RSS ≤ 178 MB; Datenbank 716 MB (mit den Indizes aus `0011`) |
| 10 Geräte gleichzeitig, je 20 × (Push von 50 Block-Updates + Delta-Pull) | 10 000 × `applied`, **keine Fehler, kein `SQLITE_BUSY`**; Push p50 72 ms, p95 153 ms, max 416 ms (vor #95: p95 415 ms, max 1,4 s); Pull p50 60 ms, p95 131 ms |
| Vollständiger Pull (neues Gerät, 520 000 Changes, 1 000 pro Seite) | 3,2 s; 264 MB übertragen; Seite p50 5 ms, max 9 ms |
| Snapshot (Re-Sync), seitenweise à 2 000 Entitäten (#97) | 2,8 s für 256 Seiten; Seite p50 10 ms, max 34 ms; 168 MB insgesamt; **RSS-Spitze 194 MB** (vor #97: eine Antwort mit 1,07 GB RSS) |
| Neues Gerät „bei Bedarf“ (ADR 0017, gemessen 2026-10-07): Snapshot ohne Blöcke | **77 ms, 3,3 MB** für 10 000 Seiten (voller Snapshot im selben Lauf: 5,1 s, 168 MB) |
| „Alles offline verfügbar machen“: alle Seiten in Paketen à 100 (`POST /api/sync/documents`) | 24,1 s für 10 000 Seiten / 500 000 Blöcke, 171 MB; Paket p50 236 ms, max 301 ms; RSS-Spitze 198 MB |
| Änderungslog für den JSON-Export | 3,1 s für 520 000 Changes |
| Serversuche (FTS5, 50 Anfragen) | p50 51 ms, p95 58 ms, max 68 ms |
| Lange Seiten: 20 Seiten à 500 Blöcke | 1 199 Ops/s, Push à 500 p50 409 ms (vor #99: 325 Ops/s, p50 1,5 s) |

**SQLite:** Der WAL-Modus und `busy_timeout = 5000` sind gesetzt (`apps/server-php/src/Database/Database.php`). Parallele Pushes serialisieren sich an der Schreibsperre. Die Wartezeit erscheint als längere Antwortzeit (max 416 ms bei 10 Geräten), nicht als Fehler.

### Client, Chromium

| Seiten / Blöcke | Snapshot schreiben | Seitenliste | Suchindex aufbauen | Suchindex laden (#98) | Suche p50 / max | JS-Heap nach Index |
| --- | --- | --- | --- | --- | --- | --- |
| 200 / 10 000 | 2,4 s | 9 ms | 0,5 s | – | 0 / 4 ms | 31 MB |
| 1 000 / 50 000 | 26 s | 17 ms | 1,1 s (vor #98: 2,5 s) | – | 1 ms | 106 MB |
| 1 000 / 50 000, Seiten nach Id wie vom Server (2026-10-05) | 41,6 s; nach den Suchmarken (#102) **28,9 s** | – | – | – | – | – |
| 10 000 / 500 000 | **5,4 min** in 256 Seiten à 2 000, je p50 1,2 s, max 2,4 s (#97) | 219 ms | 10,5 s | **0,46 s**; Speichern einmalig 3,2 s | 12 / 52 ms | 421 MB |

Die Zeilen mit 200 und 1 000 Seiten stammen aus dem Lauf vor #97; nur die Zeile mit 10 000 Seiten ist neu gemessen (2026-10-03, nach #97/#98).

**Seitenreihenfolge:** Bis 2026-10-04 schrieb das Szenario die Snapshot-Seiten nach Dokument gruppiert. Der Server sortiert sie aber nach Id (Tabelle für Tabelle), sodass jede Seite Blöcke fast aller Dokumente enthält. Gruppiert waren die Suchmarken billig und die Messung zu optimistisch (27,9 s statt 41,6 s bei 1 000 Seiten, gleiche Maschine). Seitdem sortiert das Szenario wie der Server. Die älteren Zeilen sind gruppiert gemessen.

Das Schreiben des Snapshots wird von IndexedDB bestimmt: `bulkPut` der Blöcke schafft rund 1 600–2 000 Zeilen/s. Seit #97 geschieht das in einer Transaktion pro Seite. Die App bleibt dabei bedienbar, zeigt den Fortschritt an, und ein Abbruch verliert nur den laufenden Re-Sync, nicht den lokalen Stand. Schneller wird es dadurch nicht.

**Suchindex (#98):**
- Der erste Start baut den Index auf (10,5 s) und speichert ihn danach im Leerlauf (3,2 s, einmalig).
- Jeder weitere Start lädt ihn in 0,46 s und indexiert nur die seitdem geänderten Seiten.
- Gemessen ist der Start im selben Tab. Der Heap nach Aufbau und Laden liegt bei 421 MB, ohne GC gemessen.

### App im Browser (#96)

Gemessen am 2026-10-04 mit `e2e/load-app.spec.ts`, Chromium 141 headless, Vite-Entwicklungsserver; im Production-Build sind die Zeiten eher kürzer.

| Seiten / Blöcke | Seed (Server) | Erstsync neues Gerät | Kaltstart bis Seitenbaum | Seite mit 2 000 Blöcken öffnen | Tippen am Ende dieser Seite |
| --- | --- | --- | --- | --- | --- |
| 1 000 / 52 000 | 12,8 s | 37 s | 0,84 s | 0,48 s | 5 ms pro Taste (70 Tasten) |
| 10 000 / 502 000, vor #102 | 2,7 min | 10,7 min | 31,6 s | 2,7 s | 21 ms pro Taste |
| 10 000 / 502 000, nach den ersten Fixes aus #102 | 2,8 min | 8,7 min | 3,4 s | 1,9 s | 14–20 ms pro Taste (zwei Läufe) |
| 10 000 / 502 000, ohne Tracing, Production-Build (2026-10-05) | 3,2 min | 9,8 min | 1,9 / 2,3 s (zwei Läufe) | 0,6 / 0,8 s | 4–5 ms pro Taste |
| 10 000 / 502 000, nach den Suchmarken (2026-10-05) | 3,3 min | 5,5 min | 1,9 s | 0,7 s | 6 ms pro Taste |
| 10 000 / 502 000, Seitenbaum mit einfachen Links (2026-10-05) | 3,0 min | **5,2 min** | **1,6 s** | **0,55 s** | **5 ms pro Taste** |

Der Kaltstart wird direkt nach dem Erstsync gemessen. Der Test findet die große Seite per CSS-Selektor; `getByRole` über 10 000 Baumknoten hätte die Messung selbst verlängert.

**Messfehler bis 2026-10-04:** Die ersten drei Zeilen enthalten das Playwright-Tracing (rund 1 s pro Schritt, beim Tippen etwa 14 ms pro Taste) und den Vue-Entwicklungsmodus. Ohne beides liegen Kaltstart, Öffnen der großen Seite und Tippen schon vor jeder weiteren Änderung im Ziel. Der Erstsync dauerte im Production-Build länger als im Entwicklungsserver (9,8 statt 8,7 min); die Ursache ist nicht untersucht, beide Zahlen sind vor der Suchmarken-Korrektur gemessen.

**Wohin die Zeit beim Kaltstart ging** (CPU-Profil, Production-Build, 10 000 Seiten, vor den einfachen Links): rund 0,6 s für das Anlegen der 10 000 `TreeNode`-Komponenten, davon ein großer Teil `RouterLink`; rund 0,4 s Layout und Style; der Rest Lesen aus IndexedDB und GC.

Behoben in [#102](https://github.com/mszkb/notion-alternative/issues/102):
- **Suchmarken beim Re-Sync:** Der Server liefert die Snapshot-Seiten nach Id sortiert. Jede Seite mit 2 000 Blöcken berührt deshalb fast jede Seite des Workspace, und für jede wurde eine Suchmarke (`searchDirty`) geschrieben: bei 10 000 Seiten rund 450 000 zusätzliche Zeilen, etwa ein Drittel der Schreibzeit. Jetzt wird eine Seite nur beim ersten Berühren markiert und am Ende, in derselben Transaktion wie der Cursor, für alle geschriebenen Seiten erneut. Ein zwischendurch gespeicherter Suchindex kann so keine Seite ohne Marke zurücklassen.
- **Seitenbaum mit einfachen Links:** Jeder der 10 000 Baumknoten hatte einen `RouterLink`, der seine Route auflöste und bei jeder Navigation seinen Aktiv-Zustand neu berechnete. Jetzt löst die Seitenleiste den Seitenlink einmal pro Workspace auf; ein Knoten ist ein einfacher Link mit `aria-current`. Klicks mit Strg/Cmd/Umschalt bleiben beim Browser (neuer Tab), wie bei `RouterLink`. Kaltstart mit einer Ebene von 10 000 Seiten und je einem Block (drei Läufe): 2,0–2,2 s → 1,2–1,4 s; Öffnen einer Seite 0,7–0,9 s → 0,5–0,65 s.
- **Kein Gewinn: Vorabladen der nächsten Snapshot-Seite.** Der Server liefert alle 256 Seiten in rund 3 s; der Erstsync blieb bei 9,7 min. Die Änderung ist wieder entfernt. Der Hauptthread ist beim Erstsync zu 80 % untätig; die Zeit liegt in IndexedDB.
- **Seitenbaum quadratisch:** Jeder Baumknoten filterte die ganze Seitenliste nach seinen Kindern, bei jeder Änderung einer Seite. Bei 10 000 Seiten waren das 100 Mio. Vergleiche. Jetzt gruppiert die Seitenleiste einmal pro Änderung nach Eltern, und unveränderte Seitenobjekte bleiben erhalten. Vue rendert dann nur geänderte Knoten neu.
- **Re-Sync:** Er meldet die geschriebenen Seiten einmal am Ende (oder beim Abbruch) statt nach jeder der 256 Snapshot-Seiten.
- **Suchindex:** Sind viele Seiten auf einmal geändert, wird er neu aufgebaut statt Seite für Seite. Dabei gibt er dem UI zwischendurch Zeit und speichert das Ergebnis.

**Noch nicht gemessen:** Smartphone (iOS/Android). Abgestimmt in [#96](https://github.com/mszkb/notion-alternative/issues/96): eine einmalige manuelle Messung mit 1 000 Seiten, gegen dieselben Zielwerte.

## Gefundene und behobene Engpässe

- **Suchindex beim Push (Server):**
  - Die FTS5-Spalte `document_id` ist `unindexed`. `reindexDocument` hat die Zeile einer Seite deshalb per Full-Scan über den ganzen Index gesucht, und das bei jeder angewendeten Operation.
  - Vorher: Durchsatz fallend auf etwa 150 Ops/s schon bei 200 000 Operationen. Ein Seed mit 500 000 Blöcken hätte Stunden gedauert.
  - Behoben mit Migration `0009_search_rowids`: Die Zeile wird jetzt über eine Rowid-Tabelle angesprochen. Ergebnis: konstant 658 Ops/s.
- **Neuaufbau des Suchtexts pro Block-Operation (Server, [#99](https://github.com/mszkb/notion-alternative/issues/99)):**
  - Jede Block-Operation hat den Suchtext der ganzen Seite neu aufgebaut. Ein Push mit vielen Blöcken einer Seite kostete daher quadratisch.
  - Jetzt markiert die Operation die Seite nur (`search_dirty`, Migration `0010`). Neu indexiert wird einmal pro Seite am Ende des Pushs, vor jeder Suche und beim Start.
  - Ergebnis: 1 118 statt 658 Ops/s im großen Lauf; bei Seiten mit 500 Blöcken 1 199 statt 325 Ops/s.
- **Link-Index beim Re-Sync (Client):**
  - Pro Block lief ein eigener Schreibzugriff, obwohl der Index vorher geleert wurde. Jetzt ist es ein `bulkPut`.
  - Bei 50 000 Blöcken: 27 s statt 34 s.
- **Commit pro Operation beim Push** ([#95](https://github.com/mszkb/notion-alternative/issues/95)):
  - Jede Operation lief in einer eigenen Transaktion, mit einem fsync pro Commit. Kysely hat dazu jede Abfrage neu vorbereitet.
  - Jetzt läuft ein Batch in einer Transaktion mit `SAVEPOINT` je Operation. Vorbereitete Statements werden pro SQL-Text wiederverwendet.
  - Gemessen mit 2 000 Seiten / 100 000 Blöcken, sonst Standardparameter:

    | | vorher | nachher |
    | --- | --- | --- |
    | Seed | 1 353 Ops/s | **3 921 Ops/s** |
    | Push à 500, p50 / p95 | 364 / 417 ms | **130 / 155 ms** |
    | 10 Geräte parallel: Push p50 / p95 / max | 167 / 336 / 1 105 ms | **64 / 131 / 363 ms** |
    | Pull p95 bei 10 Geräten | 296 ms | 111 ms |
    | Server-RSS beim Seed | – | 179 MB |

  - Der Gewinn auf einem Raspberry Pi mit SD-Karte dürfte größer sein, weil dort ein fsync deutlich teurer ist als im Testcontainer.
- **Snapshot in einer Antwort** (behoben mit [#97](https://github.com/mszkb/notion-alternative/issues/97)):
  - Server-RSS über 1 GB bei 500 000 Blöcken.
  - Jetzt seitenweise mit festem Cursor: RSS-Spitze 297 MB, nach #95 194 MB, im Rahmen des Normalbetriebs.
  - Ohne `limit` antwortet der Server weiter in einem Stück, für ältere, noch zwischengespeicherte Clients.
- **Aufbau des lokalen Suchindex** (behoben mit [#98](https://github.com/mszkb/notion-alternative/issues/98)): erst Bulk-Lesen (25 s → 10,5 s), dann der gespeicherte Index (Start 0,46 s).

## Grenzen und offene Engpässe

- **App bei 10 000 Seiten ([#102](https://github.com/mszkb/notion-alternative/issues/102)):**
  - Kaltstart 1,6 s, Seite mit 2 000 Blöcken öffnen 0,55 s, Tippen 5 ms pro Taste: alles im Ziel.
  - Weiterer Spielraum beim Kaltstart nur mit einem Seitenbaum, der nicht alle Knoten auf einmal anlegt (virtualisiert oder nachladend). Das würde die Seitenleiste sichtbar ändern und ist nicht umgesetzt.
  - Erstsync 5,2 min, bestimmt von IndexedDB (Blöcke, Link-Index, Suchmarken in einer Transaktion pro Seite).
- **Erstsync „bei Bedarf“ (ADR 0017, 2026-10-07):** Ein neues Gerät schreibt bei 10 000 Seiten nur Seitenbaum und Metadaten in IndexedDB: **12,8 s** statt über 5 Minuten (Client-Szenario, Chromium im Testcontainer; Seitenliste danach 263 ms). Die Inhalte kommen beim Öffnen einer Seite. Der Container war in diesem Lauf langsamer als am 2026-10-04 (Seed 1 849 statt 3 149 Ops/s); die Verhältnisse gelten, die absoluten Werte schwanken.
- **Re-Sync großer Workspaces im Browser:**
  - Bei 500 000 Blöcken dauert das Schreiben in IndexedDB weiterhin rund 5 Minuten, jetzt aber in Abschnitten und mit Fortschrittsanzeige.
  - Die Daten gehen über das Netz einmal als Snapshot (168 MB) und danach als Pull ab dem Cursor.
  - Bei einem neuen Gerät wäre ein Import ohne Link-Index und ohne Prüfung auf verlorene Inhalte schneller. Das ist nicht umgesetzt, weil die Prüfungen die Invarianten aus #75 schützen.
- **Erster Aufbau des Suchindex:** Bei 10 000 Seiten dauert er 10,5 s, bis die Suche alles findet. Danach startet der Index aus dem Speicher.
- **Seitenliste:**
  - 219 ms bei 10 000 Seiten, Ziel 200 ms. Im vorigen Lauf waren es 303 ms, ohne Änderung an `listDocuments`; der Unterschied ist Messschwankung.
  - Die Zeit geht fast vollständig in das Lesen der 10 000 Seiten aus IndexedDB.
  - Die Seitenleiste lädt die Liste bei jeder Änderung an einer Seite neu (`useLiveQuery`). Für noch größere Workspaces bräuchte es eine Liste im Speicher, die nur geänderte Seiten nachlädt.

Zielwerte für den Referenz-Host (VPS oder Raspberry Pi 4) bis zu 10 000 Seiten. Die Zielwerte der App (#96) sind seit 2026-10-05 abgestimmt:

| Vorgang | Ziel |
| --- | --- |
| Push à 500 Operationen | < 2 s |
| Delta-Pull | < 1 s |
| Serversuche | < 300 ms |
| Lokale Suche | < 50 ms |
| Seitenliste lokal | < 200 ms (gemessen 219 ms bei 10 000 Seiten) |
| Kaltstart bis Seitenbaum (#96) | < 2 s |
| Seite mit 2 000 Blöcken öffnen (#96) | < 1 s |
| Tippen (#96) | < 16 ms pro Taste (ein Frame) |
| Server-RSS | < 512 MB im Normalbetrieb |

Bei 10 000 Seiten verfehlen nur noch die Dauer des Re-Syncs im Browser und knapp die Seitenliste das Ziel (siehe oben); Kaltstart, Öffnen großer Seiten und Tippen liegen im Ziel. Der Server-RSS beim Snapshot liegt seit #97 im Ziel. Bis etwa 1 000 Seiten / 50 000 Blöcke bleiben alle Vorgänge außer dem Re-Sync (27 s) im Ziel.
