# Export

Der Export ist in der Seitenleiste unter **Export** erreichbar. Er entsteht aus den Daten auf diesem Gerät und funktioniert deshalb auch ohne Server oder Internet.

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

Format und Hintergründe: [ADR 0004](../adr/0004-export-format.md).
