# Manuelle Offline-Prüfliste für Smartphones

Was sich nicht im Headless-Browser automatisieren lässt (Safari/WebKit, echte Funkverbindung, App im Hintergrund), wird vor Releases auf echten Geräten geprüft. Ergebnis mit Gerät, OS- und Browserversion im Release-Protokoll vermerken.

Voraussetzung: App über HTTPS bzw. den in [`docs/user/installation.md`](../user/installation.md) beschriebenen Weg erreichbar, als PWA installiert (iOS: „Zum Home-Bildschirm“, Android: „App installieren“), angemeldet, mindestens eine Seite mit Text und einem Bild vorhanden und synchronisiert.

| # | Schritt | Erwartung | iOS | Android |
| --- | --- | --- | --- | --- |
| M-01 | Flugmodus an, App vom Home-Bildschirm neu starten (vorher aus dem App-Umschalter entfernen) | App startet, Seitenbaum und Inhalte sichtbar, Status „Offline – lokale Daten“ | ☐ | ☐ |
| M-02 | Im Flugmodus Text ändern, neue Seite anlegen, Bild öffnen | Änderungen werden „Lokal gespeichert“, Bild wird aus dem Gerät angezeigt | ☐ | ☐ |
| M-03 | App in den Hintergrund, 10 Minuten warten, wieder öffnen (weiter offline) | Änderungen aus M-02 vorhanden, kein Datenverlust, kein Login-Zwang | ☐ | ☐ |
| M-04 | App aus dem App-Umschalter beenden, neu starten (weiter offline) | wie M-03 | ☐ | ☐ |
| M-05 | Flugmodus aus, App in den Vordergrund holen | Sync startet ohne Zutun (Fokus/`online`), Zähler „ausstehend“ geht auf 0; Änderungen auf einem zweiten Gerät sichtbar | ☐ | ☐ |
| M-06 | Während eines Syncs (viele Änderungen) WLAN aus- und Mobilfunk einschalten | Sync läuft weiter oder wiederholt sich, keine doppelten Blöcke | ☐ | ☐ |
| M-07 | Auf dem Gerät offline bearbeiten, auf einem zweiten Gerät denselben Block ändern, dann online | Konfliktanzeige auf der Seite, beide Stände erhalten | ☐ | ☐ |
| M-08 | Länger als die Sitzungsdauer offline bleiben (oder Gerät im Konto entfernen), dann online | Status „Sitzung abgelaufen“, Inhalte weiter les- und bearbeitbar; nach Anmeldung werden die Änderungen übertragen | ☐ | ☐ |
| M-09 | Push-Benachrichtigungen aktiviert, App geschlossen, auf anderem Gerät ändern | Hinweis kommt ohne Inhalt; beim Öffnen wird synchronisiert. Ohne Push: Sync beim Öffnen | ☐ | ☐ |
| M-10 | Gerätespeicher fast voll (große Datei auf das Gerät kopieren), Text ändern | Meldung „Speicher voll“, Text bleibt auf dem Bildschirm; nach Platz schaffen wird gespeichert | ☐ | ☐ |
| M-11 | iOS: Safari-Websitedaten nicht löschen, aber 7+ Tage die PWA nicht öffnen | Hinweis zur Speicher-Persistenz beachten; Daten nach Öffnen weiter vorhanden (sonst als Befund melden) | ☐ | – |

Bekannte Plattformgrenzen: iOS kann Daten nicht installierter Websites nach längerer Nichtnutzung löschen; deshalb Installation als PWA und regelmäßiger Export (siehe Persistenz-Hinweis in der Seitenleiste).
