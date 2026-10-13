# Workspaces teilen

Ein Workspace lässt sich mit anderen Konten auf demselben Server teilen ([ADR 0014](../adr/0014-sharing-and-permissions.md)). Wer Mitglied ist, sieht alle Seiten des Workspace. Einzelne Seiten lassen sich nicht mit Konten teilen: Dafür einen eigenen Workspace anlegen (Startseite → „Neuer Workspace“) und die Seiten dorthin übernehmen. Wer nur lesen soll und kein Konto hat, bekommt einen [Lese-Link](#lese-links-für-personen-ohne-konto).

## Mitglieder einladen

1. In der Seitenleiste unten **Mitglieder** öffnen.
2. Die E-Mail-Adresse eines Kontos auf diesem Server eingeben und eine Rolle wählen.
3. **Hinzufügen**. Eine E-Mail wird nicht verschickt; das Konto sieht den Workspace beim nächsten Abgleich in seiner Workspace-Liste („geteilt“).

Ein Konto lässt sich nur einladen, wenn es auf diesem Server schon existiert. Mitglieder verwalten braucht eine Verbindung zum Server.

## Rollen

| Rolle | Darf |
| --- | --- |
| Lesen | Seiten lesen, durchsuchen und exportieren |
| Kommentieren | wie Lesen; Kommentare folgen in einer späteren Version |
| Bearbeiten | Seiten anlegen, ändern, verschieben, löschen und wiederherstellen |
| Besitzer | zusätzlich Mitglieder einladen, Rollen ändern und Mitglieder entfernen |

Besitzer können weitere Besitzer ernennen. Wer den Workspace angelegt hat, bleibt immer Besitzer und lässt sich nicht entfernen; die Anhänge des Workspace zählen zu seinem Speicherplatz.

Mit „Lesen“ oder „Kommentieren“ zeigt die App oben den Hinweis **Nur lesen**, und alle Bearbeitungsfunktionen sind ausgeblendet. Offline gilt die zuletzt bekannte Rolle.

## Verlassen und entfernen

- **Verlassen:** unter Mitglieder **Workspace verlassen** (alle außer dem Ersteller).
- **Entfernen:** Besitzer entfernen Mitglieder unter Mitglieder.

Danach liefert der Server dem Konto nichts mehr aus dem Workspace. Was schon auf seinen Geräten liegt, lässt sich bei einer Offline-App nicht aus der Ferne löschen. Die App zeigt dort **Zugriff entzogen**: Die Seiten bleiben lesbar und exportierbar, ändern und synchronisieren geht nicht mehr. Unter Mitglieder → **Vom Gerät entfernen** löscht man sie von diesem Gerät.

## Abgelehnte Änderungen

Hat jemand offline geschrieben, während die eigene Rolle auf „Lesen“ gesenkt oder das Konto entfernt wurde, nimmt der Server diese Änderungen nicht an. Sie gehen nicht verloren: Die Seitenleiste zeigt „… Änderungen vom Server abgelehnt“. Der Link führt zu einer Liste mit dem Grund. Dort:

1. **In eigenen Workspace kopieren** legt eine Kopie des Workspace mit allen Änderungen auf diesem Gerät als eigenen Workspace an.
2. Danach **Abgelehnte Änderungen verwerfen**: Im geteilten Workspace gilt wieder der Stand vom Server.

## Lese-Links für Personen ohne Konto

Mit einem Lese-Link kann jemand eine einzelne Seite lesen, ohne ein Konto auf dem Server zu haben ([ADR 0022](../adr/0022-read-links.md)). Er sieht nur diese Seite: keine anderen Seiten, keine Mitglieder, keinen Verlauf.

1. Seite öffnen, oben rechts **⋯** → **Lese-Link teilen**.
2. Gültigkeit wählen (1 Tag bis 1 Jahr oder unbefristet) und **Link erstellen**.
3. Den Link **kopieren** und weitergeben.

Der Link wird **nur einmal angezeigt**: Der Server speichert ihn nicht lesbar, damit auch ein Backup keine gültigen Links verrät. Link verloren? Einen neuen erstellen und den alten widerrufen.

Gut zu wissen:

- Lese-Links anlegen und widerrufen dürfen alle mit der Rolle **Bearbeiten** oder **Besitzer**. Dafür braucht es eine Verbindung zum Server, und die Seite muss schon synchronisiert sein.
- Der Link zeigt immer den aktuellen Stand der Seite auf dem Server.
- Bilder der Seite und ihr Titelbild sind sichtbar. Dateianhänge zeigen nur ihren Namen, herunterladen können sie nur Mitglieder. Links auf andere Seiten erscheinen als normaler Text.
- Der Link gilt nicht mehr, sobald er **widerrufen** wird, abläuft, die Seite gelöscht wird (auch im Papierkorb) oder die Person, die ihn erstellt hat, nicht mehr bearbeiten darf oder den Workspace verlässt. Der Gast sieht dann „Link nicht verfügbar“.
- Wer den Link hat, kann die Seite lesen. Nur an Personen schicken, die sie sehen dürfen. Suchmaschinen werden gebeten, solche Seiten nicht aufzunehmen (`noindex`).
- Gäste brauchen eine Internetverbindung; offline und Export gibt es nur für Mitglieder.
