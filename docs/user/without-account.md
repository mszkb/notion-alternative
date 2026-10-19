# Ohne Konto loslegen

Die App lässt sich sofort benutzen, ohne Konto und ohne Anmeldung ([ADR 0023](../adr/0023-local-area-without-account.md)). Beim ersten Öffnen landest du direkt im Bereich **„Auf diesem Gerät“** und kannst Seiten anlegen und schreiben.

- Die Seiten liegen nur im Browser dieses Geräts. Unten in der Seitenleiste steht **„Nur auf diesem Gerät“**.
- Alles Lokale funktioniert: Seitenbaum, Editor, Tags, Favoriten, Backlinks, Suche, Papierkorb und Export (Markdown, JSON, ZIP).
- Die App lässt sich auch ohne Konto installieren und startet offline.
- Ohne Konto gibt es kein Synchronisieren, keine weiteren Geräte, kein Teilen und keinen Verlauf auf dem Server. Dafür meldest du dich an.

Wichtig: Löscht man die Website-Daten des Browsers, sind die Seiten weg. Wer ohne Konto arbeitet, sollte ab und zu exportieren (**Export & Import** in der Seitenleiste).

## Später anmelden

Unten in der Seitenleiste auf **Anmelden** klicken und ein Konto anlegen bzw. sich anmelden. Die Seiten von diesem Gerät kommen dabei mit ins Konto, mit Unterseiten, Tags, Favoriten, Icons, Titelbildern und Anhängen. Seiten im Papierkorb bleiben zurück.

- **Neues Konto** (oder ein Konto ohne Seiten): Die Seiten kommen ohne Rückfrage in deinen Workspace.
- **Konto mit Seiten:** Die App fragt **„Wohin mit deinen Seiten?“**. Du wählst einen bestehenden Workspace, in dem du bearbeiten darfst, oder legst einen neuen an. In einem bestehenden Workspace landen die Seiten unter einer neuen Seite **„Von diesem Gerät (Datum)“**, damit nichts durcheinanderkommt; was dort schon ist, bleibt unverändert.

Danach zeigt die App, wie viele Seiten übernommen wurden, und synchronisiert sie wie jede andere Änderung, auch später, falls gerade keine Verbindung besteht. Wird die Übernahme unterbrochen (Tab geschlossen, Absturz), geht sie beim nächsten Öffnen weiter, ohne dass Seiten doppelt entstehen.

Lehnt der Server etwas ab, etwa weil der Speicherplatz für Anhänge voll ist, steht das unter **„Vom Server abgelehnt“**. Die Seiten bleiben auf diesem Gerät erhalten.

## Nach dem Abmelden

Nach dem Abmelden zeigt die App die Anmeldung. Mit **Ohne Konto weiterarbeiten** arbeitest du wieder im Bereich „Auf diesem Gerät“. Wurden die Seiten schon ins Konto übernommen, beginnt der Bereich leer.
