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

¹ Playwright (`apps/web/e2e/offline.spec.ts`): Server nicht erreichbar (alle `/api`-Requests schlagen fehl) sowie Netzverlust in der geladenen App; T-OFF-02 zusätzlich auf Datenebene (`apps/web/src/local/store.test.ts`). Neuladen bei echtem Netz-Offline (`context.setOffline`) gegen den Production-Build mit Service Worker in `apps/web/e2e/pwa-offline.spec.ts` (Playwright-Projekt `pwa`).

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

⁴ Pull (`GET /api/sync/pull`): zwei lokale Datenbanken gegen ein Änderungslog in `apps/web/src/sync/pull.test.ts` (inkl. Teilbaum, Tags, Backlinks, Abbruch mitten im Paging), zwei Browser-Kontexte in `apps/web/e2e/multi-device.spec.ts`.

⁵ Kompaktierung per `compactChangeLog` simuliert: Server (`apps/server/test/sync-snapshot.test.ts`, `410`), Client (`apps/web/src/sync/resync.test.ts`, ungesyncte Änderungen bleiben erhalten); manueller Re-Sync in `apps/web/e2e/sync.spec.ts`.

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
| T-EXP-01 | Vollständiger Export (MD, JSON, ZIP) | Alle Dokumente, Tags, Links, Anhänge enthalten | AC-04 | teilweise ¹² |
| T-EXP-02 | Export → Import in frische Installation | Round-Trip ohne Verlust | AC-05 | ☐ |

## PWA / Push

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-PWA-01 | Installation auf iOS | PWA installierbar | AC-06 | manuell ⁸ |
| T-PWA-02 | Push-Zustimmung nach Nutzeraktion | Subscription registriert, Push empfangen | AC-06 | ☑ ¹⁰ |
| T-PWA-03 | Push empfangen | Delta-Sync wird ausgelöst; Payload ohne Inhalte | – | ☑ ¹⁰ |

## Backups & Migrationen

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-BAK-01 | Backup erstellen und in leere Umgebung restoren | Daten & Anhänge vollständig | AC-09 | ☐ |
| T-MIG-01 | Server-Migration auf bestehenden Daten | Kein Datenverlust, App funktionsfähig | – | ☐ |
| T-MIG-02 | Lokales Schema-Upgrade mit ungesyncter Queue | Queue bleibt erhalten und wird gesynct | – | ☑ ⁹ |

⁸ Manuelle Prüfliste in [`docs/user/installation.md`](../user/installation.md#prüfliste-t-pwa-01-manuell). Automatisiert: Installierbarkeit in Chromium (`apps/web/e2e/pwa-offline.spec.ts`), Installations-Button und iOS-Hinweis (`apps/web/e2e/install.spec.ts`).

⁹ Dexie-Version 1 → 2 mit Inhalten und Queue-Eintrag in `apps/web/src/local/conflicts.test.ts`; die erhaltenen Operationen werden danach normal gepusht.

¹⁰ Server: `apps/server/test/push.test.ts` (Versand an andere Geräte, entschlüsselter Payload ohne Inhalte, Bündelung, `410`, Allowlist), `push-crypto.test.ts` (RFC-8291-Testvektor, VAPID). Client: `apps/web/e2e/pwa-push.spec.ts` – Push-Event per Chromium-CDP an den Service Worker löst den Sync aus; Aktivieren nur per Klick (Browser-Subscription in Headless-Chromium gestubbt). Zustellung über einen echten Push-Dienst manuell prüfen.

¹¹ Eigenschaftstest gegen den echten Server in `apps/web/src/sync/convergence.integration.test.ts`: drei `LocalStore`-Geräte, 60 zufällige Schritte (Bearbeiten, Anlegen, Löschen, Verschieben, Sync) mit verlorenen Push-Antworten und abgebrochenen Pulls, feste Seeds. Danach: leere Queues, identische Blöcke auf allen Geräten und dem Server, jede Bearbeitung in einem Block oder Konfliktobjekt auffindbar.

¹² Markdown: `packages/shared/src/export-markdown.test.ts` (Dateinamen, Kollisionen, Ordner, Front Matter, Linkauflösung, Anhänge, Tombstones), `packages/shared/src/zip.test.ts`, `apps/web/e2e/export.spec.ts` (Download offline, Inhalt des ZIP). JSON: `packages/shared/src/export-json.test.ts` (Tombstones, Links, Chunk-Serialisierung gegen das Schema), `apps/server/test/sync-snapshot.test.ts` (`/api/sync/log` nach Kompaktierung), `apps/server/test/export-schema.test.ts` (JSON Schema aktuell), E2E mit/ohne Verlauf und offline. Vollständiges ZIP folgt.
