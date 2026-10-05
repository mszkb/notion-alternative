# Testmatrix

Bezüge auf [Akzeptanzkriterien](../product/acceptance-criteria.md) (AC-xx). Spalte „Auto“ = automatisierter Test vorhanden.

## Offline / Online

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-OFF-01 | App ohne Netz öffnen | Lokale Dokumente lesbar | AC-01, AC-08 | ☑ ¹ |
| T-OFF-02 | Offline bearbeiten, neu laden | Änderung bleibt lokal erhalten | AC-01 | ☑ ¹ |
| T-OFF-03 | Offline bearbeiten, dann online | Änderung wird synchronisiert | AC-02 | ☑ ⁴ |
| T-OFF-04 | Server down, Netz vorhanden | Lesen & Bearbeiten möglich, Queue wächst | AC-08 | ☑ ³ |
| T-OFF-05 | Verbindung bricht während Sync ab | Kein Datenverlust, Wiederholung idempotent | AC-02 | ☑ ³ |
| T-OFF-06 | Push deaktiviert | Sync bei Start/Fokus/Timer | AC-07 | ☑ ⁶ |
| T-OFF-07 | Server-Neustart (Absturz) während Sync | Nichts verloren, nichts doppelt angewendet | AC-02 | ☑ ¹⁴ |
| T-OFF-08 | Sitzung läuft offline ab | Lokale Daten les-/bearbeitbar, nach Anmeldung gesynct | AC-01, AC-08 | ☑ ¹⁴ |
| T-OFF-09 | Lokaler Speicher voll | Sichtbare Meldung, Text bleibt erhalten und wird erneut gespeichert | AC-01 | ☑ ¹⁴ |
| T-OFF-10 | Mehrere Tabs offline | Änderungen aller Tabs bleiben, werden genau einmal gesendet | AC-02 | ☑ ¹⁴ |
| T-OFF-11 | Smartphone: Flugmodus, Hintergrund, Neustart | Siehe Prüfliste | AC-01, AC-08 | manuell ¹⁵ |

¹ Playwright (`apps/web/e2e/offline.spec.ts`): Server nicht erreichbar (alle `/api`-Requests schlagen fehl) sowie Netzverlust in der geladenen App; T-OFF-02 zusätzlich auf Datenebene (`apps/web/src/local/store.test.ts`). Neuladen bei echtem Netz-Offline (`context.setOffline`) gegen den Production-Build mit Service Worker in `apps/web/e2e/pwa-offline.spec.ts` (Playwright-Projekt `pwa`); dort auch T-OFF-03 mit echtem Netz: wieder online, die Offline-Änderung erreicht ohne Zutun den Server.

³ Push (`POST /api/sync/push`): `apps/server/test/sync-push.test.ts` (Duplikate, verlorene Antwort), `apps/web/src/sync/push.test.ts` (Abbruch nach Server-Commit, Wiederholung), `apps/web/e2e/sync.spec.ts` (Server down, Queue wächst und wird danach gesendet).

⁶ `apps/web/src/sync/triggers.test.ts` (Start, Fokus, `online`, Sichtbarkeit, Timer nur bei sichtbarer App, Entprellung), `apps/web/src/sync/engine.test.ts` (ein Lauf gleichzeitig, auch über Tabs per Web Locks), `apps/web/e2e/multi-device.spec.ts` (Timer mit vorgespulter Uhr, „Jetzt synchronisieren“).

## Mehrere Geräte & Konflikte

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-MD-01 | Gerät A ändert, B synct | B sieht Änderung | AC-02 | ☑ ⁴ |
| T-MD-02 | A und B ändern verschiedene Blöcke desselben Dokuments offline | Automatischer Block-Merge | AC-03 | ☑ ⁷ |
| T-MD-03 | A und B ändern denselben Block offline | Sichtbarer Konflikt, beide Stände erhalten | AC-03 | ☑ ⁷ |
| T-MD-04 | Gleiche Operation doppelt gesendet | Nur einmal angewendet (Idempotenz) | AC-02 | ☑ ³ |
| T-MD-05 | Gerät lange offline, Log kompaktiert | Vollständiger Re-Sync | AC-02 | ☑ ⁵ |
| T-MD-06 | Drei Geräte, zufällige Offline-Änderungen, verlorene Antworten | Alle konvergieren zum Serverstand, keine Änderung geht still verloren | AC-02, AC-03 | ☑ ¹¹ |
| T-MD-07 | Re-Sync seitenweise: Abbruch mitten im Re-Sync, Neustart; Entitäten entstehen oder werden gelöscht zwischen zwei Seiten | Kein Cursor nach Abbruch, Re-Sync wird vollständig wiederholt; Endstand gleich dem Serverstand, nichts doppelt oder fälschlich neu angelegt | AC-02 | ☑ ⁵ |
| T-MD-08 | Gerät wird in der Geräteliste entfernt, arbeitet lokal weiter und meldet sich neu an ([#46](https://github.com/mszkb/notion-alternative/issues/46)) | Synchronisiert als neues Gerät weiter, die Warteschlange wird gesendet, nichts geht verloren; die alte ID bleibt entfernt; eine Session von vor der Entfernung endet | AC-02 | ☑ ¹⁸ |

⁴ Pull (`GET /api/sync/pull`): zwei lokale Datenbanken gegen ein Änderungslog in `apps/web/src/sync/pull.test.ts` (inkl. Teilbaum, Tags, Backlinks, Abbruch mitten im Paging), zwei Browser-Kontexte in `apps/web/e2e/multi-device.spec.ts`.

⁵ Kompaktierung per `compactChangeLog` simuliert: Server (`apps/server/test/sync-snapshot.test.ts`, `410`), Client (`apps/web/src/sync/resync.test.ts`, ungesyncte Änderungen bleiben erhalten); manueller Re-Sync in `apps/web/e2e/sync.spec.ts`. Seitenweiser Snapshot (T-MD-07, #97): Server (`apps/server/test/sync-snapshot.test.ts`: jede Entität genau einmal bei verschiedenen Seitengrößen, fester Cursor, Entitäten zwischen zwei Seiten über den Pull), Client (`apps/web/src/sync/resync.test.ts`: Fortschritt, Cursor erst am Ende, Abbruch und Neustart, Entstehen/Löschen zwischen Seiten, ungesyncte und vom Server verlorene Inhalte über Seiten hinweg).

⁷ `apps/server/test/sync-conflicts.test.ts` (Merge verschiedener Blöcke und Felder, Konfliktobjekt, Idempotenz, Auflösung), `apps/web/src/local/conflicts.test.ts` (Pull, Auflösen offline, Wiederherstellen), `apps/web/e2e/multi-device.spec.ts` (Konfliktansicht mit manuellem Zusammenführen, Löschkonflikt wiederherstellen).

## Löschungen

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-DEL-01 | A löscht Dokument, B synct | Tombstone repliziert, Dokument auf B entfernt | AC-02 | ☑ ⁴ |
| T-DEL-02 | A löscht, B bearbeitet offline dasselbe Dokument | Konflikt sichtbar, kein stiller Verlust | AC-03 | ☑ ⁴ |
| T-DEL-03 | Seite mit Unterseiten löschen | Konsistente Behandlung des Teilbaums | – | ☑ ² ⁴ |

² Lokal: Tombstones für den ganzen Teilbaum (`store.test.ts`, `e2e/editor.spec.ts`); über zwei Geräte in `apps/web/src/sync/pull.test.ts`. T-DEL-02 zusätzlich serverseitig in `apps/server/test/sync-apply.test.ts`.

## Export / Import

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-EXP-01 | Vollständiger Export (MD, JSON, ZIP) | Alle Dokumente, Tags, Links, Anhänge enthalten | AC-04 | ☑ ¹² |
| T-EXP-02 | Export → Import in frische Installation | Round-Trip ohne Verlust | AC-05 | ☑ ¹³ |

## PWA / Push

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-PWA-01 | Installation auf iOS | PWA installierbar | AC-06 | manuell ⁸ |
| T-PWA-02 | Push-Zustimmung nach Nutzeraktion | Subscription registriert, Push empfangen | AC-06 | ☑ ¹⁰ |
| T-PWA-03 | Push empfangen | Delta-Sync wird ausgelöst; Payload ohne Inhalte | – | ☑ ¹⁰ |

## Backups & Migrationen

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-BAK-01 | Backup erstellen und in leere Umgebung restoren | Daten & Anhänge vollständig | AC-09 | ☑ ¹⁶ |
| T-MIG-01 | Server-Migration auf bestehenden Daten | Kein Datenverlust, App funktionsfähig | – | ☑ ¹⁶ |
| T-MIG-02 | Lokales Schema-Upgrade mit ungesyncter Queue | Queue bleibt erhalten und wird gesynct | – | ☑ ⁹ |

## Last

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-LOAD-01 | Großer Workspace (10 000 Seiten, 500 000 Blöcke): Seed, 10 Geräte parallel, Pull, Snapshot, Export-Log, Suche | Keine Fehler/`SQLITE_BUSY`, Zeiten und RAM innerhalb der Zielwerte | – | ☑ ¹⁷ |
| T-LOAD-02 | Großer lokaler Bestand im Browser: Re-Sync, Seitenliste, Suchindex, Suche | Zielwerte aus `load-tests.md` | – | ☑ ¹⁷ |
| T-LOAD-03 | Große Workspaces in der App: Erstsync, Kaltstart, Seite mit 2 000 Blöcken öffnen, Tippen | Zielwerte aus `load-tests.md` | – | ☑ ¹⁷ |

## Telemetrie

Geplant mit [ADR 0016](../adr/0016-opt-in-telemetry.md) (`Proposed`, [#109](https://github.com/mszkb/notion-alternative/issues/109)); noch nicht umgesetzt.

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-TEL-01 | Frische Instanz, ein Tag simulierte Laufzeit | Keine ausgehende Verbindung (abgefangenes `fetch`), kein Zähler in SQLite oder IndexedDB | – | ☐ |
| T-TEL-02 | Betreiber stimmt zu, ein Nutzer nicht | Nur Betriebsdaten; keine Nutzungszähler dieses Kontos, weder gepuffert noch gesendet | – | ☐ |
| T-TEL-03 | Payload mit Markern in Titel, Text, Suchbegriff, Dateiname, E-Mail | Nur Felder aus dem [Datenkatalog](../privacy/telemetry.md); kein Marker, keine UUID im Payload | – | ☐ |
| T-TEL-04 | Vorschau und Versand | Vorschau gleich gesendetem Payload | – | ☐ |
| T-TEL-05 | Widerruf durch Nutzer bzw. Betreiber | Lokale und serverseitige Puffer gelöscht | – | ☐ |
| T-TEL-06 | Offline bzw. Empfänger nicht erreichbar | App und Sync unverändert; Puffer wachsen nicht über 7 Tage hinaus; keine Wiederholung | – | ☐ |
| T-TEL-07 | Upgrade einer bestehenden Instanz | Telemetrie bleibt aus | – | ☐ |

⁸ Manuelle Prüfliste in [`docs/user/installation.md`](../user/installation.md#prüfliste-t-pwa-01-manuell). Automatisiert: Installierbarkeit in Chromium (`apps/web/e2e/pwa-offline.spec.ts`), Installations-Button und iOS-Hinweis (`apps/web/e2e/install.spec.ts`).

⁹ Dexie-Version 1 → 2 mit Inhalten und Queue-Eintrag in `apps/web/src/local/conflicts.test.ts`; die erhaltenen Operationen werden danach normal gepusht. Version 2 → 3 in `apps/web/src/local/attachments.test.ts`, Version 3 → 4 (gespeicherter Suchindex, #98) in `apps/web/src/local/search.test.ts`: Inhalte und Queue bleiben, der erste Start baut den Index auf und speichert ihn. Invalidierung des gespeicherten Index (Änderungen ohne laufende Suche, Änderung während des Speicherns, Re-Sync, beschädigter oder veralteter Cache) ebenda.

¹⁰ Server: `apps/server/test/push.test.ts` (Versand an andere Geräte, entschlüsselter Payload ohne Inhalte, Bündelung, `410`, Allowlist), `push-crypto.test.ts` (RFC-8291-Testvektor, VAPID). Client: `apps/web/e2e/pwa-push.spec.ts` – Push-Event per Chromium-CDP an den Service Worker löst den Sync aus; Aktivieren nur per Klick (Browser-Subscription in Headless-Chromium gestubbt). Zustellung über einen echten Push-Dienst manuell prüfen.

¹¹ Eigenschaftstest gegen den echten Server in `apps/web/src/sync/convergence.integration.test.ts`: drei `LocalStore`-Geräte, 60 zufällige Schritte (Bearbeiten, Anlegen, Löschen, Verschieben, Sync) mit verlorenen Push-Antworten und abgebrochenen Pulls, feste Seeds. Danach: leere Queues, identische Blöcke auf allen Geräten und dem Server, jede Bearbeitung in einem Block oder Konfliktobjekt auffindbar.

¹² Markdown: `packages/shared/src/export-markdown.test.ts` (Dateinamen, Kollisionen, Ordner, Front Matter, Linkauflösung, Anhänge, Tombstones), `packages/shared/src/zip.test.ts`, `apps/web/e2e/export.spec.ts` (Download offline, Inhalt des ZIP). JSON: `packages/shared/src/export-json.test.ts` (Tombstones, Links, Chunk-Serialisierung gegen das Schema), `apps/server/test/sync-snapshot.test.ts` (`/api/sync/log` nach Kompaktierung), `apps/server/test/export-schema.test.ts` (JSON Schema aktuell), E2E mit/ohne Verlauf und offline. Vollständiges ZIP: `packages/shared/src/export-archive.test.ts` (Aufbau, Manifest, Prüfsummen, Manipulation erkannt), E2E `T-EXP-01` mit Anhängen online und offline (fehlender Anhang ausgewiesen).

¹³ Round-Trip: `apps/server/test/export-roundtrip.test.ts` – Workspace mit allen Blocktypen, verschachtelten Seiten, Tags, Favoriten, Seitenlinks, Anhängen, Verlauf und Tombstones → ZIP → frische Instanz; Entitäten, Änderungslog, Anhang-Bytes und Markdown identisch. Dazu wird jedes Fixture in `apps/server/test/fixtures/exports/` (eins pro `schema_version`) bei jedem Lauf importiert. Weitere Fälle: `apps/server/test/import.test.ts` (Export einer Instanz in eine zweite, leere Instanz: Entitäten identisch, Papierkorb, Verlauf, Suche, Anhang-Upload, Weiterarbeiten; `409` bei vorhandenen IDs, Kopie mit neuen IDs; Referenzen, Version, Speicherlimit). Shared: `import.test.ts` (Migration über mehrere Versionen, ID-Umschreibung, bösartige ZIPs: Zip-Slip, Duplikate, Größen, Komprimierung). E2E: `apps/web/e2e/export.spec.ts` (ZIP-Import über die Oberfläche, ungültige und manipulierte Dateien, Kopie, Anhang wird hochgeladen).

¹⁴ T-OFF-07: `apps/web/src/sync/restart.integration.test.ts` – echter Server-Prozess wird mitten im Push per `SIGKILL` beendet und mit derselben Datenbank neu gestartet; danach leere Queue, Serverstand gleich lokalem Stand, jede Operation genau einmal im Änderungslog. T-OFF-08/09/10: `apps/web/e2e/offline-hardening.spec.ts` (Sitzung offline abgelaufen und neu angemeldet; IndexedDB-Schreibfehler `QuotaExceededError` – der Text bleibt sichtbar, auch wenn die Seite aus der Datenbank neu gerendert wird, und wird nach 5 s erneut gespeichert; zwei Tabs offline mit gemeinsamer lokaler Datenbank).

¹⁵ [`docs/testing/mobile-offline-checklist.md`](mobile-offline-checklist.md)

¹⁶ `apps/server/test/backup.test.ts`: Backup im laufenden Betrieb (SQLite-Online-Backup + Anhänge, Manifest mit SHA-256), Restore in leere Umgebung (Inhalte, Anhang-Bytes, Konten, Sitzungen, VAPID-Schlüssel), Schutz vor Überschreiben, beschädigtes Backup; T-MIG-01: Backup einer Datenbank auf Migrationsstand `0007_push` wird restauriert und auf den aktuellen Stand migriert. `scripts/backup-restore-test.sh` (CI-Job `backup`): derselbe Ablauf mit den Befehlen aus [`backup.md`](../operations/backup.md) gegen den Docker-Compose-Stack (`MODE=local` ohne Docker). Clients nach Restore: `apps/web/src/sync/restore.integration.test.ts` (echter Server, Restore eines älteren Backups: Gerät synchronisiert neu und sendet Fehlendes und neuere Stände erneut), `apps/web/src/sync/resync.test.ts`.

¹⁷ Manuell gestartete Skripte, nicht in CI (Laufzeit): `scripts/loadtest/server-load.mjs`, `apps/web/scripts/loadtest-browser.mjs` (Szenario `apps/web/src/local/load-scenario.ts`), `apps/web/e2e/load-app.spec.ts` (T-LOAD-03, nur mit `LOAD_PAGES`). Ergebnisse, Zielwerte und offene Grenzen: [`load-tests.md`](load-tests.md). Regression des Suchindex-Engpasses: `apps/server/test/migrations.test.ts` (0009), Link-Index nach Re-Sync: `apps/web/src/sync/resync.test.ts`.

¹⁸ Server: `apps/server/test/devices.test.ts` (neue ID nach erneuter Anmeldung, Session von vor der Entfernung endet mit `401`). Client: `apps/web/src/local/store.test.ts` (Warteschlange zieht auf die neue ID um, Ablehnungen wegen der Entfernung werden zurückgesetzt, anderer Tab übernimmt die ID), `apps/web/src/device.test.ts`, `apps/web/src/sync/engine.test.ts` (Tab mit veralteter ID sendet erneut). E2E: `apps/web/e2e/devices.spec.ts`.
