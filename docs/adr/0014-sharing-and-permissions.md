# 0014 – Sharing, Berechtigungen und Kommentare

- **Status:** Accepted
- **Datum:** 2026-10-03, angenommen 2026-10-09

## Kontext

Phase 8 soll kleine Teams auf derselben Installation unterstützen (Zielgruppe 3 in [`vision.md`](../product/vision.md)): Inhalte teilen ([#78](https://github.com/mszkb/notion-alternative/issues/78)), Rechte durchsetzen ([#80](https://github.com/mszkb/notion-alternative/issues/80)), kommentieren ([#79](https://github.com/mszkb/notion-alternative/issues/79)).

Heute gehört jeder Workspace genau einem Konto (`workspaces.owner_id`). Alle Datenzugriffe laufen über `findWorkspaceForUser`. Das Änderungslog und der Sync-Cursor gelten pro Workspace ([ADR 0002](0002-sync-protocol.md)). Ein Gerät gehört einem Konto.

Folgende Prinzipien gelten weiter:

- Local-first und offline-first.
- Keine stillen Überschreibungen ([ADR 0003](0003-conflict-resolution.md)).
- Push ohne Inhalte ([ADR 0005](0005-push.md)).
- Export first: Jedes Mitglied kann exportieren, was es sehen darf.

## Optionen

1. **Workspace als Freigabeeinheit:** Ein Workspace hat mehrere Mitglieder mit je einer Rolle.
   - **+** Änderungslog, Cursor, Snapshot und Tombstones bleiben unverändert. Pull und Suche filtern nur nach Mitgliedschaft, nicht pro Entität. Damit ist das Risiko eines Datenlecks durch einen falsch gefilterten Pull klein.
   - **+** Rechte sind ohne Vererbung im Seitenbaum leicht verständlich.
   - **−** Eine einzelne Seite lässt sich nicht teilen. Man verschiebt sie stattdessen in einen geteilten Workspace.
2. **Seiten- bzw. Teilbaum-Freigaben mit Vererbung:**
   - **+** Feiner steuerbar.
   - **−** Jeder Pull, Snapshot, jede Suche und jeder Export braucht einen Filter pro Entität.
   - **−** Ein Cursor pro Workspace reicht nicht mehr: Beim Entzug eines Rechts müssen „Entfernt“-Ereignisse kommen, beim Verschieben einer Seite in oder aus einem freigegebenen Teilbaum ändert sich die Sichtbarkeit rückwirkend.
   - **−** Viel mehr Fälle für Tests und Lecks.
3. **Öffentliche Lese-Links für Externe:** Ergänzung zu 1 oder 2, kein Ersatz.

## Entscheidung

Option 1. Option 3 kommt später mit eigenem ADR.

**Datenmodell:** neue Tabelle `workspace_members(workspace_id, user_id, role, added_at)`, Primärschlüssel `(workspace_id, user_id)`. Die Migration trägt jeden bisherigen Besitzer als `owner` ein. `owner_id` bleibt erhalten; es bestimmt, wessen Speicherkontingent die Anhänge belasten.

**Rollen:**

| Rolle | Lesen, Export | Kommentieren | Inhalte ändern | Mitglieder verwalten |
| --- | --- | --- | --- | --- |
| `reader` | ✓ | – | – | – |
| `commenter` | ✓ | ✓ | – | – |
| `editor` | ✓ | ✓ | ✓ | – |
| `owner` | ✓ | ✓ | ✓ | ✓ |

**Einladen:** Ein Besitzer lädt ein existierendes Konto derselben Installation per E-Mail-Adresse ein. Der Server verschickt keine Mails. Mitglieder hinzufügen, entfernen und Rollen ändern darf nur ein Besitzer.

**Mehrere Besitzer:** Ein Besitzer darf andere Mitglieder zu `owner` machen. Der Ersteller (`owner_id`) trägt das Speicherkontingent; er lässt sich weder entfernen noch herabstufen. Damit hat ein Workspace immer mindestens einen `owner`. Jedes Mitglied außer dem Ersteller kann den Workspace selbst verlassen.

**Durchsetzung, nur serverseitig maßgeblich:**

- `findWorkspaceForUser` wird zu einer Abfrage der Mitgliedschaft, die die Rolle zurückgibt.
- Jeder Endpunkt prüft die Mindestrolle: Pull, Log, Snapshot, Suche, Verlauf, Anhang-Download und Export brauchen `reader`. Push braucht je nach Entität `commenter` (Kommentare) oder `editor` (Inhalte). Mitgliederverwaltung braucht `owner`.
- Eine Operation ohne Recht wird als `rejected` mit `code: 'forbidden'` beantwortet, nicht als HTTP-Fehler für den ganzen Batch.
- Fremde Workspaces bleiben `404`, damit ihre Existenz nicht verraten wird.

**Offline-Änderungen ohne Recht** (Recht wurde entzogen, während das Gerät offline war):

- Abgelehnte Operationen bleiben lokal erhalten. Der Client zeigt sie als „nicht übertragbar“ an.
- Er bietet an, die betroffenen Seiten als Kopie mit neuen IDs in einen eigenen Workspace zu übernehmen. Das ist derselbe Mechanismus wie beim Import als Kopie.
- Nichts verschwindet still (Prinzip 6).

**Entfernte Mitglieder:**

- Der Server liefert dem entfernten Mitglied keine Daten des Workspace mehr.
- Lokale Kopien auf dessen Geräten lassen sich bei offline-first nicht zuverlässig löschen. Das sagt die UI beim Entfernen ausdrücklich.
- Das Gerät des entfernten Mitglieds erhält `404` für den Workspace. Es markiert den Workspace dann als „Zugriff entzogen“ und behält ihn schreibgeschützt. Der Nutzer kann exportieren oder lokal löschen.

**Sync und Push:**

- Der Cursor bleibt pro Workspace.
- Operationen anderer Mitglieder tragen deren `deviceId`. Die Prüfung `device_not_active` gilt weiterhin pro Konto des Absenders.
- Push-Hinweise gehen an die Geräte aller Mitglieder. Der Payload bleibt unverändert, also ohne Inhalte.

**Kommentare (#79):**

- Kommentare sind eine neue Entität `comment` mit den Feldern `documentId`, `blockId`, `parentId` (Thread), `body` (Markdown-Inline), `authorId`, `resolvedAt` und den üblichen Sync-Feldern.
- Kommentare sind an der Block-ID verankert, nicht an Textstellen. Der Grund: Textanker gehen beim Bearbeiten verloren.
- Kommentare sind offline anlegbar und laufen wie andere Entitäten durch Queue, Änderungslog und Tombstones.
- Bearbeiten und Löschen darf nur der Autor. Auflösen darf jeder ab `commenter`.
- Erwähnungen (`@Konto`) lösen einen Push-Hinweis ohne Inhalt aus.
- Der JSON-Export bekommt eine neue `schema_version` mit Kommentaren, inklusive Migration in `import.ts`.

**Nicht Teil dieses ADR:** Rechte pro Seite, SSO/SCIM, Audit-Logs, Echtzeit ([ADR 0015](0015-realtime.md)).

## Konsequenzen

- Der größte Umbau betrifft die Workspace-Abfragen: Alle Aufrufer von `findWorkspaceForUser` bekommen eine Mindestrolle. Für jeden Endpunkt und jede Rolle braucht es Autorisierungstests (Matrix: Endpunkt × Rolle × Nicht-Mitglied).
- Der Client braucht einen Workspace-Wechsler, einen schreibgeschützten Modus (Rolle wird lokal zwischengespeichert, offline gilt die zuletzt bekannte) und eine Ansicht für nicht übertragbare Operationen.
- „Seite teilen“ heißt in der UI: „In geteilten Workspace verschieben“. Das Verschieben zwischen Workspaces ist ein eigener Schritt: kopieren mit neuen IDs, dann im Quell-Workspace löschen. Der Verlauf bleibt im Quell-Workspace.
- Die Testmatrix bekommt einen Abschnitt „Teilen & Rechte“ (u. a. Pull nie mit fremden Daten, Entzug offline, entfernter Besitzer).
- Entschieden vom Maintainer (2026-10-09, #78):
  - Freigaben pro Workspace reichen für die Zielgruppe.
  - Besitzer dürfen weitere Besitzer ernennen; der Ersteller bleibt fest.
  - Das Speicherkontingent trägt der Ersteller (`owner_id`).
- Kommentare (#79) folgen in einem eigenen Schritt nach Freigaben und Rechten.
