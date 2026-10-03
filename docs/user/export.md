# Export

Der Export ist in der Seitenleiste unter **Export** erreichbar. Er entsteht aus den Daten auf diesem Gerät und funktioniert deshalb auch ohne Server oder Internet.

## Markdown (ZIP)

- Eine `.md`-Datei pro Seite. Unterseiten liegen in einem Ordner mit dem Namen der Seite (`Projekte.md` und `Projekte/Alpha.md`).
- Dateinamen werden aus Titeln gebildet. Zeichen, die unter Windows, macOS oder Linux nicht erlaubt sind, werden durch `-` ersetzt, Namen auf 60 Zeichen gekürzt. Gleiche Namen im selben Ordner bekommen ` (2)`, ` (3)` … (ohne Unterscheidung von Groß-/Kleinschreibung).
- Seitenlinks werden zu relativen Pfaden und sind in gängigen Markdown-Viewern klickbar. Links auf gelöschte Seiten bleiben als Text stehen.
- Anhänge liegen in `_attachments/` und werden relativ verlinkt. Fehlt der Inhalt eines Anhangs auf dem Gerät und ist er gerade nicht vom Server ladbar, steht im Text „(Anhang fehlt)“; die Exportmeldung nennt die Anzahl.
- Front Matter je Datei: `id`, `title`, `tags`, `favorite`, `created_at`, `updated_at`.
- Nur der aktuelle Stand: gelöschte Seiten (Papierkorb) und der Verlauf sind nicht enthalten.

Format und Hintergründe: [ADR 0004](../adr/0004-export-format.md).
