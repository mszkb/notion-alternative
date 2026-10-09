# Workspaces teilen

Ein Workspace lässt sich mit anderen Konten auf demselben Server teilen ([ADR 0014](../adr/0014-sharing-and-permissions.md)). Wer Mitglied ist, sieht alle Seiten des Workspace. Einzelne Seiten lassen sich nicht teilen: Dafür einen eigenen Workspace anlegen (Startseite → „Neuer Workspace“) und die Seiten dorthin übernehmen.

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
