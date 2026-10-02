# Testmatrix

Bezüge auf [Akzeptanzkriterien](../product/acceptance-criteria.md) (AC-xx). Spalte „Auto“ = automatisierter Test vorhanden.

## Offline / Online

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-OFF-01 | App ohne Netz öffnen | Lokale Dokumente lesbar | AC-01, AC-08 | ☐ |
| T-OFF-02 | Offline bearbeiten, neu laden | Änderung bleibt lokal erhalten | AC-01 | ☐ |
| T-OFF-03 | Offline bearbeiten, dann online | Änderung wird synchronisiert | AC-02 | ☐ |
| T-OFF-04 | Server down, Netz vorhanden | Lesen & Bearbeiten möglich, Queue wächst | AC-08 | ☐ |
| T-OFF-05 | Verbindung bricht während Sync ab | Kein Datenverlust, Wiederholung idempotent | AC-02 | ☐ |
| T-OFF-06 | Push deaktiviert | Sync bei Start/Fokus/Timer | AC-07 | ☐ |

## Mehrere Geräte & Konflikte

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-MD-01 | Gerät A ändert, B synct | B sieht Änderung | AC-02 | ☐ |
| T-MD-02 | A und B ändern verschiedene Blöcke desselben Dokuments offline | Automatischer Block-Merge | AC-03 | ☐ |
| T-MD-03 | A und B ändern denselben Block offline | Sichtbarer Konflikt, beide Stände erhalten | AC-03 | ☐ |
| T-MD-04 | Gleiche Operation doppelt gesendet | Nur einmal angewendet (Idempotenz) | AC-02 | ☐ |
| T-MD-05 | Gerät lange offline, Log kompaktiert | Vollständiger Re-Sync | AC-02 | ☐ |

## Löschungen

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-DEL-01 | A löscht Dokument, B synct | Tombstone repliziert, Dokument auf B entfernt | AC-02 | ☐ |
| T-DEL-02 | A löscht, B bearbeitet offline dasselbe Dokument | Konflikt sichtbar, kein stiller Verlust | AC-03 | ☐ |
| T-DEL-03 | Seite mit Unterseiten löschen | Konsistente Behandlung des Teilbaums | – | ☐ |

## Export / Import

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-EXP-01 | Vollständiger Export (MD, JSON, ZIP) | Alle Dokumente, Tags, Links, Anhänge enthalten | AC-04 | ☐ |
| T-EXP-02 | Export → Import in frische Installation | Round-Trip ohne Verlust | AC-05 | ☐ |

## PWA / Push

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-PWA-01 | Installation auf iOS | PWA installierbar | AC-06 | ☐ |
| T-PWA-02 | Push-Zustimmung nach Nutzeraktion | Subscription registriert, Push empfangen | AC-06 | ☐ |
| T-PWA-03 | Push empfangen | Delta-Sync wird ausgelöst; Payload ohne Inhalte | – | ☐ |

## Backups & Migrationen

| ID | Szenario | Erwartung | AC | Auto |
| --- | --- | --- | --- | --- |
| T-BAK-01 | Backup erstellen und in leere Umgebung restoren | Daten & Anhänge vollständig | AC-09 | ☐ |
| T-MIG-01 | Server-Migration auf bestehenden Daten | Kein Datenverlust, App funktionsfähig | – | ☐ |
| T-MIG-02 | Lokales Schema-Upgrade mit ungesyncter Queue | Queue bleibt erhalten und wird gesynct | – | ☐ |
