# 0019 – Blocktypen To-do, Toggle, Hinweis, Trenner

- **Status:** Accepted
- **Datum:** 2026-10-07, angenommen 2026-10-08

## Kontext

Umsteiger von Notion erwarten To-dos, einklappbare Toggles, Hinweis-Kästen (Callouts) und Trennlinien ([#135](https://github.com/mszkb/notion-alternative/issues/135), Zielgruppe in [`vision.md`](../product/vision.md)). Das Datenmodell kennt bisher eine flache, geordnete Liste von Blöcken pro Seite ([ADR 0008](0008-block-editor.md)); Verschachtelung gibt es nur für Listenpunkte über `attrs.indent`. Neue Typen ändern das Exportformat ([ADR 0004](0004-export-format.md)) und die Validierung im Sync.

## Optionen

Für die Kinder eines Toggles:

1. **Echte Hierarchie** (`parentId` am Block). **+** Wie Notion intern. **−** Neues Feld in Sync, Merge, Export, Undo und Editor; Verschieben eines Toggles muss die Kinder mitnehmen; großer Umbau.
2. **Einrückung wie bei Listen:** Die Blöcke direkt nach einem Toggle mit größerem `attrs.indent` sind seine Kinder. **+** Kein neues Feld, das flache Modell, Merge und Undo bleiben; dieselbe Logik wie bei Listen. **−** Kinder gehören nur über ihre Position zum Toggle; ein Verschieben des Toggles verschiebt die Kinder nicht mit.

Für den Zustand „eingeklappt“:

1. Synchronisiert (`attrs.collapsed`). **−** Jedes Auf- und Zuklappen wäre eine Operation und könnte Konflikte erzeugen.
2. **Pro Gerät** (lokal gespeichert). **+** Kein Sync-Verkehr, keine Konflikte; so verhält sich auch Notion.

## Entscheidung

- Neue Werte von `blockTypeSchema`: `todo`, `toggle`, `callout`, `divider`. Neue Attribute: `checked` (bool, `todo`) und `icon` (Emoji, bis 16 Zeichen, `callout`). `indent` gilt jetzt auch für To-dos und für Kinder eines Toggles.
- **Toggle-Kinder über die Einrückung (Option 2).** Enter am Toggle legt das erste Kind an; Tab rückt einen Block unter einen Toggle ein, Umschalt+Tab und Backspace am Anfang rücken ihn wieder heraus.
- **Eingeklappt pro Gerät** (`localStorage`), nicht synchronisiert.
- **Trenner** hat keinen Text (wie Bilder und Dateien ein „Atom“ ohne Eingabefeld).
- **Markdown-Export:** To-do als Aufgabenliste (`- [ ]`, `- [x]`), Toggle als Listenpunkt mit eingerückten Kindern, Hinweis als Zitat mit Emoji (`> 💡 …`), Trenner als `---`. Verlustfrei bleibt der JSON-Export.
- **Exportformat `schema_version` 2.** Die Migration 1 → 2 übernimmt Version-1-Exporte unverändert (sie enthalten nur alte Typen). Fixture `v2.zip` und `export.schema.json` neu erzeugt.
- **Konflikte:** `checked` steckt in `attrs`. Gleichzeitiges Abhaken auf zwei Geräten mit unterschiedlichem Ergebnis ist ein sichtbarer Konflikt (ADR 0003); Abhaken auf einem und Text ändern auf dem anderen Gerät wird gemerged.

## Konsequenzen

- Server und Client validieren mit demselben Schema aus `@notion-alt/shared`; ein Server-Update reicht für die Annahme.
- **Ältere App-Versionen** kennen die Typen nicht: Ihr Pull überspringt die Änderung als ungültig, auf dem Server und in Exporten bleibt sie erhalten. Die App aktualisiert sich über den Service Worker beim nächsten Öffnen („Neue Version verfügbar“) und holt sie dann nach einem vollständigen Neu-Synchronisieren nach. Ein Export einer neuen Version lässt sich in einer alten nicht importieren (`schema_version` 2 → Hinweis „neuere Version“).
- Der Import aus Notion ([#137](https://github.com/mszkb/notion-alternative/issues/137)) kann To-dos, Toggles, Callouts und Trenner direkt abbilden.
- Später möglich: weitere Typen nach demselben Muster (neuer Wert, Attribute, Export-Version).
