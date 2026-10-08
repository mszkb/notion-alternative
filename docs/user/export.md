# Export

Der Export ist in der Seitenleiste unter **Export & Import** erreichbar. Er entsteht aus den Daten auf diesem Gerät und funktioniert deshalb auch ohne Server oder Internet.

## Vollständig (ZIP)

Empfohlen für Backups. Das ZIP enthält:

| Pfad | Inhalt |
| --- | --- |
| `manifest.json` | Exportzeitpunkt, `schema_version`, Workspace, ob der Verlauf enthalten ist, Größe und SHA-256 jeder Datei, Zuordnung Anhang → Pfad, `missing_attachments` |
| `workspace.json` | JSON-Export (siehe unten) |
| `markdown/` | Markdown-Export (siehe unten), Anhänge in `markdown/_attachments/` |

Anhänge, deren Inhalt weder auf dem Gerät liegt noch gerade vom Server geladen werden kann (z. B. offline), fehlen nicht still: Die Exportseite listet sie nach dem Export auf, und sie stehen im Manifest unter `missing_attachments`.

Prüfen lässt sich ein Export z. B. mit `unzip export.zip -d export && cd export && sha256sum markdown/Seite.md` gegen den Eintrag im Manifest.

## Markdown (ZIP)

- Eine `.md`-Datei pro Seite. Unterseiten liegen in einem Ordner mit dem Namen der Seite (`Projekte.md` und `Projekte/Alpha.md`).
- Dateinamen werden aus Titeln gebildet. Zeichen, die unter Windows, macOS oder Linux nicht erlaubt sind, werden durch `-` ersetzt, Namen auf 60 Zeichen gekürzt. Gleiche Namen im selben Ordner bekommen ` (2)`, ` (3)` … (ohne Unterscheidung von Groß-/Kleinschreibung).
- Seitenlinks werden zu relativen Pfaden und sind in gängigen Markdown-Viewern klickbar. Links auf gelöschte Seiten bleiben als Text stehen.
- Anhänge liegen in `_attachments/` und werden relativ verlinkt. Fehlt der Inhalt eines Anhangs auf dem Gerät und ist er gerade nicht vom Server ladbar, steht im Text „(Anhang fehlt)“; die Exportmeldung nennt die Anzahl.
- Front Matter je Datei: `id`, `title`, `tags`, `favorite`, `created_at`, `updated_at`.
- Nur der aktuelle Stand: gelöschte Seiten (Papierkorb) und der Verlauf sind nicht enthalten.

## JSON

- Verlustfreie Kopie für Backup und Import: Seiten, Blöcke, Tags, Tag-Zuordnungen, Seitenlinks und Anhang-Metadaten mit ihren stabilen IDs, **inklusive gelöschter Einträge** (Papierkorb).
- Top-Level-Feld `schema_version` (aktuell `1`). Das Schema steht als JSON Schema in [`docs/architecture/export.schema.json`](../architecture/export.schema.json) und als zod-Schema `jsonExportSchema` in `packages/shared`.
- **Mit Verlauf** (Standard, nur online): zusätzlich das Änderungslog des Servers unter `history.changes`. Ist das Log kompaktiert, fehlen die Einträge bis `history.compactedSeq`. **Ohne Verlauf** ist `history` `null`.
- Der aktuelle Stand stammt aus der lokalen Datenbank und enthält auch noch nicht synchronisierte Änderungen; offline ist nur der Export ohne Verlauf möglich.
- Die Datei wird in kleinen Stücken (eine Entität pro Zeile) erzeugt, damit große Workspaces nicht als ein einziger String im Speicher liegen müssen.

## Import

Unter **Export & Import** → **Import** lässt sich ein vollständiger Export (ZIP) oder ein JSON-Export wieder herstellen, z. B. nach einem Umzug in eine frische Installation:

1. Exportdatei wählen. Vor dem Import werden geprüft: ZIP-Struktur, Größe und SHA-256 jeder Datei laut `manifest.json`, Anhänge gegen ihre Metadaten, das JSON gegen das Schema. Ältere `schema_version`s werden automatisch migriert; Exporte einer neueren App-Version werden abgelehnt.
2. Die Seite zeigt eine Zusammenfassung (Seiten, Papierkorb, Anhänge, Verlauf). Namen für den neuen Workspace wählen, **Als neuen Workspace importieren**.
3. Der Import legt immer einen **neuen** Workspace an und überschreibt nie etwas. Gibt es die IDs auf dem Server schon (z. B. derselbe Export wurde bereits importiert oder der Ursprungs-Workspace liegt noch auf diesem Server), bricht er ohne Änderung ab und bietet **Als Kopie importieren** an: Alle Seiten, Blöcke, Tags und Anhänge bekommen dann neue IDs, Links werden mit umgeschrieben.

Hinweise:

- Der Import braucht eine Verbindung zum Server; die Daten kommen danach wie gewohnt per Sync auf alle Geräte.
- Anhang-Inhalte aus dem ZIP werden auf dem Gerät abgelegt und beim nächsten Sync hochgeladen. Ein reiner JSON-Export enthält keine Anhang-Inhalte; diese Anhänge erscheinen dann als fehlend.
- Der Verlauf aus dem Export bleibt in der Versionsansicht erhalten. Offene Konflikte werden nicht exportiert.
- Ordner mit Markdown-Dateien lassen sich (noch) nicht importieren; dafür ist der JSON-Teil da.

Format und Hintergründe: [ADR 0004](../adr/0004-export-format.md).

## Umzug aus Notion

In Notion unter **Einstellungen → Export** das Format **„Markdown & CSV“** wählen, Unterseiten und Dateien einschließen und die ZIP-Datei herunterladen. In dieser App: **Export & Import → Umzug aus Notion**, Datei wählen. Vor dem Import zeigt die App, was übernommen und was vereinfacht wird; importiert wird als neuer Workspace (online).

| In Notion | Hier |
| --- | --- |
| Seiten und Unterseiten | Seiten im Seitenbaum, Titel ohne Notions ID-Anhang |
| Überschriften, Listen, Zitate, Code, To-dos, Toggles, Hinweise (Callouts), Trennlinien | gleiche Blocktypen; Überschriften ab Ebene 4 werden Ebene 3 |
| Fett, kursiv, Inline-Code, Weblinks | übernommen |
| Links auf andere Seiten | Seitenlinks, Backlinks funktionieren |
| Bilder und Dateien | Anhänge der Seite |
| Datenbanken (CSV) | eine Seite mit je einer Unterseite pro Eintrag (deren Eigenschaften stehen als Text oben); die vollständige Tabelle liegt als CSV-Anhang bei |
| Tabellen in einer Seite | Code-Block (die Spalten bleiben lesbar) |
| Farben, Unterstreichen, Durchstreichen, sonstiges HTML | als einfacher Text |

Warum Datenbanken als Unterseiten: Datenbanken mit Ansichten gehören nicht zum Umfang dieser App ([Vision](../product/vision.md#bewusst-nicht-im-mvp)). Als Unterseiten bleibt jeder Eintrag mit seinem Inhalt bearbeitbar, verlinkbar und durchsuchbar; die CSV-Datei bewahrt die Tabelle vollständig.

