# Lasttests

Belastbarkeit großer Workspaces ([#77](https://github.com/mszkb/notion-alternative/issues/77)). Die Skripte sind reproduzierbar: fester Zufalls-Seed für die Inhalte und keine zusätzlichen Abhängigkeiten. Das Server-Skript läuft mit reinem Node 22 und damit auch direkt auf einem Raspberry Pi.

## Skripte

| Was | Befehl | Misst |
| --- | --- | --- |
| Server | `pnpm --filter @notion-alt/server build && node scripts/loadtest/server-load.mjs` | Seed per Sync-Push (volle Batches à 500 Operationen), mehrere Geräte gleichzeitig (Push + Delta-Pull), vollständiger Pull, Snapshot (Re-Sync), Änderungslog (JSON-Export), Serversuche; RAM/CPU des Serverprozesses |
| Client (Chromium) | `pnpm --filter @notion-alt/web loadtest:browser` | Snapshot in die lokale Datenbank schreiben (neues Gerät/Re-Sync), Seitenliste, Blöcke einer Seite, Aufbau des Suchindex (MiniSearch), Suchanfragen, JS-Heap |
| Client (Node) | `pnpm --filter @notion-alt/web loadtest` | Dasselbe Szenario mit fake-indexeddb. Nur für schnelle Vergleiche: Die IndexedDB-Zeiten sind dort viel zu hoch, weil Index-Cursor quadratisch laufen (10 000 Zeilen per `anyOf`: 51 s statt 0,5 s). |

**Parameter** (Umgebungsvariablen):

- `PAGES` (Standard: Server und Chromium 1 000, Node 200) und `BLOCKS_PER_PAGE` (50).
- Nur Server: `DEVICES` (10), `ROUNDS` (20), `OPS_PER_ROUND` (50), `SEARCHES` (50).
- `OUT=datei.json` speichert das Ergebnis.

**Ziele:**

- Ohne `BASE_URL` startet das Server-Skript `apps/server/dist` mit einer temporären Datenbank und misst RAM/CPU über `/proc`.
- Mit `BASE_URL=http://127.0.0.1:3000` nimmt es einen laufenden Server. Den RAM liest es dann aus `/api/metrics`, wenn `METRICS_ENABLED=true` ist und der Endpunkt erreichbar ist.
- Gegen eine produktive Instanz nur mit `ALLOW_REGISTRATION=true` und auf eigene Gefahr. Das Skript legt ein Konto mit großem Workspace an.

Die Zielgröße aus dem Issue ist `PAGES=10000`, also 10 000 Seiten und 500 000 Blöcke.

## Ergebnisse (2026-10-03)

**Testumgebung:** Cloud-Container mit 4 vCPU (Xeon, 2,1 GHz) und 16 GB RAM, Node 22.22, Chromium 141 headless. Ein Raspberry Pi 4 ist grob um den Faktor 3–4 langsamer. Messungen dort stehen noch aus.

### Server, 10 000 Seiten / 500 000 Blöcke

| Szenario | Ergebnis |
| --- | --- |
| Seed: 510 000 Operationen in 1 020 Pushes à 500 | **658 Ops/s** über den ganzen Lauf; Push à 500: p50 753 ms, p95 842 ms, max 1,0 s; RSS ≤ 300 MB; Datenbank 661 MB |
| 10 Geräte gleichzeitig, je 20 × (Push von 50 Block-Updates + Delta-Pull) | 10 000 × `applied`, **keine Fehler, kein `SQLITE_BUSY`**; Push p50 405 ms, p95 822 ms, max 2,3 s; Pull p50 329 ms, p95 703 ms |
| Vollständiger Pull (neues Gerät, 520 000 Changes, 1 000 pro Seite) | 4,1 s; 264 MB übertragen; Seite p50 6 ms, max 28 ms |
| Snapshot (Re-Sync) | 5,6 s; **168 MB in einer Antwort; RSS-Spitze 1,08 GB** |
| Änderungslog für den JSON-Export | 3,7 s für 520 000 Changes |
| Serversuche (FTS5, 50 Anfragen) | p50 65 ms, p95 80 ms, max 92 ms |

**SQLite:** Der WAL-Modus und `busy_timeout = 5000` sind gesetzt (`apps/server/src/db/database.ts`). Parallele Pushes serialisieren sich an der Schreibsperre. Die Wartezeit erscheint als längere Antwortzeit (max 2,3 s bei 10 Geräten), nicht als Fehler.

### Client, Chromium

| Seiten / Blöcke | Snapshot schreiben | Seitenliste | Suchindex aufbauen | Suche p50 / max | JS-Heap nach Index |
| --- | --- | --- | --- | --- | --- |
| 200 / 10 000 | 2,4 s | 9 ms | 0,5 s | 0 / 4 ms | 31 MB |
| 1 000 / 50 000 | 27 s | 28 ms | 2,5 s | – | 106 MB |
| 10 000 / 500 000 | **5,5 min** | 307 ms | **25 s** | 11 / 23 ms | 318 MB (davon 184 MB Snapshot-Daten) |

Das Schreiben des Snapshots wird von IndexedDB bestimmt. `bulkPut` der Blöcke schafft rund 2 000 Zeilen/s; der Rest von `replaceWithSnapshot` (Lesen, Link-Index) braucht zusammen unter 2 s.

## Gefundene und behobene Engpässe

- **Suchindex beim Push (Server):**
  - Die FTS5-Spalte `document_id` ist `unindexed`. `reindexDocument` hat die Zeile einer Seite deshalb per Full-Scan über den ganzen Index gesucht, und das bei jeder angewendeten Operation.
  - Vorher: Durchsatz fallend auf etwa 150 Ops/s schon bei 200 000 Operationen. Ein Seed mit 500 000 Blöcken hätte Stunden gedauert.
  - Behoben mit Migration `0009_search_rowids`: Die Zeile wird jetzt über eine Rowid-Tabelle angesprochen. Ergebnis: konstant 658 Ops/s.
- **Link-Index beim Re-Sync (Client):**
  - Pro Block lief ein eigener Schreibzugriff, obwohl der Index vorher geleert wurde. Jetzt ist es ein `bulkPut`.
  - Bei 50 000 Blöcken: 27 s statt 34 s.

## Grenzen und offene Engpässe

- **Snapshot in einer Antwort** ([#97](https://github.com/mszkb/notion-alternative/issues/97)):
  - Server-RSS über 1 GB bei 500 000 Blöcken. Auf einem Raspberry Pi mit 2 GB wird das knapp.
  - Der Client hält den Snapshot ebenfalls komplett im Speicher.
  - Vorschlag: Snapshot seitenweise liefern und in Abschnitten schreiben.
- **Re-Sync großer Workspaces im Browser** ([#97](https://github.com/mszkb/notion-alternative/issues/97)): Bei 500 000 Blöcken dauert das Schreiben in IndexedDB mehrere Minuten, in einer einzigen Transaktion und ohne Fortschrittsanzeige. Vorschlag: in Abschnitten schreiben, Fortschritt anzeigen. Die Atomarität bleibt über den Cursor erhalten, der erst am Ende gesetzt wird.
- **Aufbau des lokalen Suchindex** ([#98](https://github.com/mszkb/notion-alternative/issues/98)):
  - `WorkspaceSearch.start()` liest jede Seite einzeln, mit drei Abfragen pro Seite. Bei 10 000 Seiten dauert das 25 s; Suchen findet bis dahin nur einen Teil.
  - Vorschlag: Blöcke und Tags einmal gesammelt lesen oder den Index in IndexedDB zwischenspeichern (MiniSearch `toJSON`).
- **Neuaufbau des Suchtexts pro Block-Operation (Server)** ([#99](https://github.com/mszkb/notion-alternative/issues/99)): Jede Block-Operation baut den Suchtext der ganzen Seite neu auf. Ein Push mit vielen Blöcken einer langen Seite kostet daher quadratisch. Vorschlag: einmal pro Seite und Push-Request neu indexieren.

Zielwerte für den Referenz-Host (VPS oder Raspberry Pi 4) bis zu 10 000 Seiten:

| Vorgang | Ziel |
| --- | --- |
| Push à 500 Operationen | < 2 s |
| Delta-Pull | < 1 s |
| Serversuche | < 300 ms |
| Lokale Suche | < 50 ms |
| Seitenliste lokal | < 200 ms (gemessen 307 ms bei 10 000 Seiten) |
| Server-RSS | < 512 MB im Normalbetrieb |

Snapshot, Re-Sync, lokaler Suchindex und Seitenliste großer Workspaces erreichen das noch nicht (siehe oben). Bis etwa 1 000 Seiten / 50 000 Blöcke bleiben alle Vorgänge außer dem Re-Sync (27 s) im Ziel.
