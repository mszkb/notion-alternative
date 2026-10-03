# 0008 – Editor und Inline-Repräsentation von Blöcken

- **Status:** Accepted
- **Datum:** 2026-10-02

## Kontext

Phase 2 braucht einen Editor für Überschriften, Text, Listen, Code, Links und Zitate. Vorgaben:

- Dokumente bestehen aus **Blöcken mit stabilen IDs** und eigener Revision; Reihenfolge über `sort_key` (fraktionaler Index) – siehe [sync.md](../architecture/sync.md), [ADR 0003](0003-conflict-resolution.md).
- Jede Änderung erzeugt eine Operation auf **Blockebene** ([ADR 0002](0002-sync-protocol.md)).
- Markdown-Export muss verlässlich sein ([ADR 0004](0004-export-format.md)).
- `Block.content` sollte „mit der Editor-Wahl in Phase 2“ festgelegt werden.

## Optionen

### Editor

1. **TipTap/ProseMirror** – ausgereiftes Rich-Text-Editing, Undo, Inline-Marks. Ein Dokument ist aber *ein* Baum; stabile Block-IDs (Unique-ID-Extension) und die Ableitung von Block-Operationen müssten bei jeder Transaktion per Diff berechnet werden. Größeres Bundle.
2. **Lexical** – performant, aber React-zentriert; Vue-Bindings inoffiziell. Gleiches Baum→Block-Problem.
3. **Eigener Block-Editor** – ein bearbeitbares Element pro Block (Vue-Komponente); die Blockliste entspricht 1:1 den Zeilen der lokalen Datenbank.

### Inline-Repräsentation von `content`

1. **Markdown-Inline-String** – kompakt, menschenlesbar, Export nahezu 1:1.
2. **Strukturiertes JSON** (Text-Runs mit Marks) – verlustfrei und editorfreundlich, braucht aber Serializer für Export und Suche.

## Entscheidung

**Eigener Block-Editor** und **`content` als Markdown-Inline-String.**

### Blöcke

| `type` | `content` | `attrs` |
| --- | --- | --- |
| `paragraph` | Markdown-Inline | – |
| `heading` | Markdown-Inline | `level`: 1–3 |
| `list_item` | Markdown-Inline | `list`: `bullet` \| `ordered`, `indent`: 0–5 |
| `quote` | Markdown-Inline | – |
| `code` | **Rohtext** (keine Inline-Syntax) | `language` (optional) |

Listen sind keine Container, sondern aufeinanderfolgende `list_item`-Blöcke mit Einrückung. Damit bleibt jeder Listenpunkt ein eigener Block (Merge-Granularität) und die Struktur flach.

### Inline-Syntax (Teilmenge von CommonMark)

| Syntax | Bedeutung |
| --- | --- |
| `**fett**`, `_kursiv_`, `` `code` `` | Formatierung; beim Lesen wird auch `*kursiv*` akzeptiert. Geschrieben wird kursiv mit `_`, damit fett+kursiv eindeutig bleibt (`**a _b_**` statt `**a *b***`). |
| `[Text](https://…)` | Externer Link (nur `http`, `https`, `mailto`) |
| `[Titel](page:<uuid>)` | **Seitenlink** auf ein Dokument über dessen stabile ID |
| `\*`, `\_` usw. | Escaping der Steuerzeichen `\`, `*`, `_`, `` ` ``, `[`, `]` |

- Seitenlinks referenzieren die **ID**, nicht den Titel – Umbenennen bricht keine Links. Der gespeicherte Titel ist nur Fallback-Anzeige; angezeigt wird der aktuelle Titel des Ziels.
- Backlinks werden aus `page:`-Links abgeleitet (lokaler, nicht synchronisierter Index, siehe [ADR 0009](0009-local-data-layer.md)).
- Beim Markdown-Export (Phase 6) werden `page:<uuid>` in relative Pfade übersetzt; alles andere bleibt unverändert.
- Unbekannte oder unvollständige Syntax bleibt als Text erhalten (kein Datenverlust durch den Parser).

### Bedienung

- Markdown-Kürzel am Blockanfang: `# `/`## `/`### `, `- `/`* `, `1. `, `> `, ` ``` `.
- `Enter` teilt den Block, `Backspace` am Anfang verbindet mit dem vorherigen, `Tab`/`Shift+Tab` rückt Listenpunkte ein/aus, Pfeiltasten wechseln zwischen Blöcken.
- `Strg/Cmd+B`, `+I`, `+E` (Inline-Code), `+K` (Link); `[[` öffnet die Seitenauswahl für einen Seitenlink.
- Gespeichert wird pro Block mit kurzer Verzögerung (Debounce) sowie bei Blur; jede Speicherung erzeugt eine `update`-Operation.

## Begründung

- **Passendes Datenmodell:** Block = Datenbankzeile = Merge-Einheit. Es gibt keine Abbildung eines Dokumentbaums auf Blöcke und keine Diff-Berechnung pro Tastendruck.
- **Export:** Markdown-Inline lässt sich direkt in die `.md`-Datei schreiben; nur Blockpräfixe und Seitenlinks werden übersetzt.
- **Spätere Clients:** Eine native App (nicht im MVP) könnte das Format direkt darstellen, z. B. Swift `AttributedString(markdown:)`; es muss kein Editor-internes JSON nachgebaut werden. Editor-Code ist ohnehin nicht zwischen Web und nativ teilbar – das Datenformat schon.
- **Leistung/Bundle:** Kleiner bearbeitbarer Bereich pro Block, keine großen Editor-Abhängigkeiten; lange Seiten können später virtualisiert werden.

## Konsequenzen

- Inline-Formatierung, Tastaturnavigation, Einfügen und Undo werden selbst gebaut.
- **Undo/Redo (Nachtrag, Issue #45):** Das native Undo des `contenteditable` wird abgefangen (Strg/⌘+Z, Strg/⌘+Umschalt+Z, Strg+Y, `beforeinput` mit `historyUndo`/`historyRedo`). Stattdessen hält der Editor einen Stapel von Seiten-Snapshots (`id`, `type`, `content`, `attrs` je Block in Reihenfolge, `apps/web/src/editor/history.ts`). Ein Snapshot entsteht vor jedem strukturellen Schritt (Teilen, Zusammenführen, Typwechsel, Einrücken, Verschieben, Löschen, Formatieren, Link einfügen, Einfügen aus der Zwischenablage) und zu Beginn jedes Tipp-Abschnitts (bis zum entprellten Speichern). Wiederherstellen schreibt die Differenz mit `LocalStore.applyBlockState` in **einer** Transaktion als normale Operationen (`update`, `move`, `delete`, `create`) in die Offline-Queue; es gibt keinen Sonderweg. Gelöschte Blöcke werden unter neuer ID neu angelegt, weil Tombstones endgültig bleiben; die History folgt der neuen ID. Der Verlauf gilt pro geöffneter Seite und nur lokal (kein kollaboratives Undo, Phase 8).
- **Blockauswahl (Nachtrag, Issue #45):** Ganze Blöcke lassen sich auswählen: Escape im Block, Umschalt+Pfeil am Blockrand oder Ziehen mit der Maus über Blockgrenzen. In der Auswahl: Umschalt+Pfeil erweitert, Pfeil wechselt, Strg/⌘+A wählt alles, Enter bearbeitet, Entf/Rücktaste löscht (ein Undo-Schritt), Kopieren/Ausschneiden liefern Markdown (`blocksToMarkdown` aus `@notion-alt/shared`). Eine Textauswahl, die mitten in einem Block beginnt und in einem anderen endet, gibt es weiterhin nicht; gemeinsames Formatieren mehrerer Blöcke ebenfalls nicht. Mobile Browser (Long-Press-Auswahl) sind noch nicht gezielt behandelt.
- Parser und Serializer (Markdown-Inline ↔ DOM) brauchen Round-Trip-Tests.
- Echtzeit-Kollaboration innerhalb eines Blocks (Phase 8) erfordert dann einen CRDT-Text pro Block; die stabile Block-Struktur bleibt nutzbar.
- Weitere Blocktypen (Bilder, Aufgaben, Tabellen) erweitern `type`/`attrs`; jede Erweiterung braucht eine neue Export-`schema_version`.

## Nachtrag: Bild- und Dateiblöcke (Phase 5)

Blocktypen `image` und `file` zeigen einen Anhang (`attrs.attachmentId`, [ADR 0012](0012-attachments.md)); sie haben kein Textfeld. Pfeiltasten überspringen sie, Rücktaste/Entf daneben wählt sie als Block aus (zweiter Tastendruck löscht), Typwechsel ist für sie ausgeblendet. Einfügen über das Blockmenü, „+ Bild/Datei“ oder Einfügen/Ziehen von Dateien.
