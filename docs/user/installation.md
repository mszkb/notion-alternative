# App installieren

Die Web-App lässt sich wie eine eigene App installieren. Installiert startet sie in einem eigenen Fenster, funktioniert offline (auch nach einem Neustart des Geräts) und der Browser hält die lokalen Daten zuverlässiger vor.

Voraussetzung: Die App wird über `https://` oder `http://localhost` aufgerufen (z. B. über den SSH-Tunnel, siehe [Betrieb](../operations/deployment.md)). Über eine reine HTTP-Adresse im LAN lässt sie sich nicht installieren.

## Desktop (Chrome, Edge, Brave)

- In der Seitenleiste auf **„App installieren“** klicken, oder
- in der Adressleiste auf das Installations-Symbol (Monitor mit Pfeil) klicken.

Danach erscheint die App im Startmenü bzw. Dock. Firefox und Safari (macOS) bieten keine Installation über die Seite an; Safari ab Version 17: **Ablage → Zum Dock hinzufügen**.

## Android (Chrome)

- In der Seitenleiste **„App installieren“** antippen, oder
- Menü (⋮) → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“**.

## iPhone und iPad (Safari)

iOS zeigt keinen Installations-Dialog an. Die App blendet deshalb einen Hinweis in der Seitenleiste ein (ausblendbar):

1. Die App in **Safari** öffnen.
2. **Teilen** (Quadrat mit Pfeil) antippen.
3. **„Zum Home-Bildschirm“** wählen und bestätigen.
4. Die App künftig über das neue Symbol auf dem Home-Bildschirm öffnen.

Wichtig auf iOS:

- **Benachrichtigungen** (Web Push) funktionieren nur in der installierten App, nicht im Safari-Tab.
- Daten im Safari-Tab kann iOS nach einigen Wochen ohne Nutzung löschen; in der installierten App bleiben sie erhalten. Was noch nicht synchronisiert ist, zeigt die Seitenleiste.

In der installierten App erscheinen weder der Button noch der Hinweis.

## Offline verfügbar machen

Ein neues Gerät lädt zuerst nur den Seitenbaum mit Titeln, Tags und Favoriten. Den Inhalt einer Seite lädt die App, sobald sie geöffnet wird, und behält ihn dann; die Seite ist ab da auch offline verfügbar. Bilder und Dateien lädt die App, wenn eine Seite sie zeigt.

Vor einer Reise oder einem Flug: **Konto → Offline verfügbar → „Alles offline verfügbar machen“**. Die App lädt dann alle Seiten und Anhänge; ein Balken zeigt den Fortschritt. „Abbrechen“ hält jederzeit an, Geladenes bleibt, ein erneuter Klick setzt fort. Danach hält das Gerät alle Seiten offline bereit, auch neue von anderen Geräten. „Nur bei Bedarf laden“ stellt zurück.

Nur die Anhänge laden: „Alle Anhänge offline verfügbar machen“. Anhänge, die ein anderes Gerät noch nicht hochgeladen hat, kommen beim nächsten Mal.

Wird ohne Verbindung eine Seite geöffnet, deren Inhalt nicht auf dem Gerät ist, zeigt die App einen Hinweis statt einer leeren Seite. Geräte, die schon vor diesem Update eingerichtet waren, halten weiterhin alle Seiten offline bereit.

## Prüfliste T-PWA-01 (manuell)

Für Releases auf einem echten Gerät durchgehen und Ergebnis mit iOS-Version im Release-Protokoll vermerken:

- [ ] Safari zeigt die App-Seite über `https://` an; Hinweis „Zum Home-Bildschirm“ ist in der Seitenleiste sichtbar
- [ ] Nach „Zum Home-Bildschirm“: Symbol mit App-Icon (blaues Seiten-Symbol) und Name „Notizen“
- [ ] Start über das Symbol öffnet ohne Safari-Leisten; der Hinweis ist dort nicht mehr sichtbar
- [ ] Flugmodus an, App schließen und neu starten: Seiten sind lesbar und bearbeitbar
- [ ] Flugmodus aus: Änderungen werden synchronisiert („0 lokale Änderungen noch nicht synchronisiert“)
