# Funktionen im Überblick

Was die App kann, ob es offline geht und wo es ausführlich beschrieben ist. Wie Web-App und Android-App im Einzelnen zueinander stehen, steht im [Feature-Verzeichnis für Entwickler](../architecture/feature-parity.md).

| Funktion | Kurzbeschreibung | Status | Offline | Links |
| --- | --- | --- | --- | --- |
| [Workspaces teilen (Mitglieder und Rollen)](#workspaces-teilen-mitglieder-und-rollen) | Einen Workspace mit anderen Konten auf demselben Server teilen; Rollen Lesen, Kommentieren, Bearbeiten, Besitzer. | neu (PR #177) | Lesen ja, Bearbeiten nach Rolle; Mitglieder verwalten nur online | [Anleitung](sharing.md), [ADR 0014](../adr/0014-sharing-and-permissions.md) |

## Workspaces teilen (Mitglieder und Rollen)

Ausführliche Anleitung: [Workspaces teilen](sharing.md). Entscheidung: [ADR 0014](../adr/0014-sharing-and-permissions.md), Issues #78 (Sharing) und #80 (Berechtigungen).

### Was geteilt wird

- Geteilt wird immer der ganze Workspace: Mitglieder sehen alle Seiten darin.
- Einzelne Seiten lassen sich nicht teilen. Stattdessen einen eigenen Workspace anlegen und die Seiten dorthin übernehmen.

### Mitglieder einladen

- Seitenleiste unten → **Mitglieder** → E-Mail-Adresse und Rolle → **Hinzufügen**.
- Das geht nur mit Konten, die auf diesem Server schon existieren. Es wird keine E-Mail verschickt.
- Das Konto sieht den Workspace beim nächsten Abgleich in seiner Workspace-Liste, markiert als „geteilt · <Rolle>“.
- Mitglieder verwalten braucht eine Serververbindung.

### Rollen

| Rolle | Darf |
| --- | --- |
| Lesen | Seiten lesen, durchsuchen, exportieren |
| Kommentieren | vorerst wie Lesen; Kommentare folgen später (#79) |
| Bearbeiten | Seiten anlegen, ändern, verschieben, löschen, wiederherstellen; Anhänge hochladen |
| Besitzer | zusätzlich Mitglieder einladen, Rollen ändern, Mitglieder entfernen |

### Besitzer

- Besitzer können weitere Besitzer ernennen.
- Wer den Workspace angelegt hat, bleibt immer Besitzer: Diese Person kann weder entfernt noch herabgestuft werden und kann den Workspace nicht verlassen.
- Anhänge im Workspace zählen zum Speicherplatz dieser Person.

### Lesemodus

- Mit „Lesen“ oder „Kommentieren“ steht oben der Hinweis **Nur lesen** mit der Rolle.
- Alle Bearbeitungsfunktionen sind ausgeblendet: Text, Titel, Icon, Titelbild, Tags, neue Seiten, Verschieben, Löschen, Papierkorb, Verlauf wiederherstellen, Konflikte auflösen.
- Offline gilt die zuletzt bekannte Rolle.

### Verlassen und entfernen

- Jedes Mitglied außer dem Ersteller kann unter Mitglieder **Workspace verlassen**.
- Besitzer entfernen Mitglieder unter Mitglieder.
- Danach liefert der Server diesem Konto nichts mehr. Was schon auf seinen Geräten liegt, lässt sich bei einer Offline-App nicht aus der Ferne löschen. Die App zeigt dort **Zugriff entzogen**: lesbar und exportierbar, aber kein Bearbeiten und kein Abgleich mehr.
- Unter Mitglieder → **Vom Gerät entfernen** löscht das Mitglied die Seiten selbst von diesem Gerät.

### Abgelehnte Änderungen

Wichtig, weil die App auch offline arbeitet:

- Wer offline schreibt, während seine Rolle gesenkt oder sein Konto entfernt wird, dessen Änderungen nimmt der Server nicht an.
- Nichts geht verloren: Die Seitenleiste zeigt „… Änderung(en) vom Server abgelehnt“, der Link öffnet eine Liste mit dem Grund.
- Dort **In eigenen Workspace kopieren**: Das legt eine Kopie mit allen Änderungen auf diesem Gerät als eigenen Workspace an.
- Danach optional **Abgelehnte Änderungen verwerfen**: Im geteilten Workspace gilt wieder der Stand vom Server.

### Benachrichtigungen

- Ändert ein Mitglied etwas, bekommen die Geräte der anderen Mitglieder den üblichen Sync-Hinweis per Push, ohne Inhalte.
- Entfernte Mitglieder bekommen keine Hinweise mehr.

### Noch nicht enthalten

- Keine Freigabe einzelner Seiten.
- Keine Kommentare (geplant, #79).
- Keine Echtzeit-Zusammenarbeit und keine Cursor anderer.
- Die Android-App (PR #176) kennt die Rollen noch nicht.

<details>
<summary>Technische Details für Betreiber und Entwickler</summary>

- **Server**
  - Neue Tabelle `workspace_members` (Migration 0016). Bestehende Installationen brauchen nichts zu tun.
  - Der Ersteller steht weiter in `workspaces.owner_id` und hat dort keine Zeile.
- **API**
  - `GET/POST /api/workspaces/:id/members`, `PATCH/DELETE /api/workspaces/:id/members/:userId`.
  - `GET /api/workspaces` liefert zusätzlich `role`.
  - Fehlercodes: `user_not_found`, `already_member`, `creator_fixed`, `forbidden`.
  - Konten außerhalb bekommen `404`, damit fremde Workspaces nicht verraten werden.
- **Sync:** Änderungen ohne Recht werden pro Operation als `rejected` mit Code `forbidden` beantwortet.
- **Tests:** Contract-Tests `packages/contract-tests/test/sharing.test.ts` prüfen jeden Endpunkt für jede Rolle und für Konten außerhalb.

</details>
