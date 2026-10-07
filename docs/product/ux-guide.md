# UX-Leitlinie

Wie die Oberfläche aussieht und sich bedient ([#131](https://github.com/mszkb/notion-alternative/issues/131), Epic [#130](https://github.com/mszkb/notion-alternative/issues/130)). Primäre Zielgruppe sind Umsteiger von Notion ([`vision.md`](vision.md)): Wer Notion kennt, soll sich ohne Anleitung zurechtfinden.

## Leitplanke

Wir übernehmen **Bedienmuster**: Aufbau, Abläufe, Tastenkürzel, Begriffe und Dichte. Wir übernehmen **keine Markenelemente**:

- keine Logos, Icons, Illustrationen, Screenshots oder Texte;
- keine lizenzierten Schriften, kein Farbschema als Erkennungszeichen;
- der Name „Notion“ erscheint in der Oberfläche nur, wo es um Import oder Umstieg geht.

Icons kommen aus einer freien Bibliothek oder sind eigene Zeichen, Farben sind eigene (Tokens unten).

Die Produktprinzipien gelten unverändert: Jede Bedienung funktioniert offline, nichts wird still überschrieben (`CLAUDE.md`).

## Bedienmuster

| Muster (wie in Notion) | Unsere Umsetzung | Stand |
| --- | --- | --- |
| Seitenleiste links: Suche, Favoriten, Seitenbaum, Papierkorb, Einstellungen unten | `WorkspaceLayout.vue`, `composables/sidebar.ts` | umgesetzt: einklappbar (`Strg/⌘ + \`), Breite per Ziehen oder Pfeiltasten am Rand, beides pro Gerät gemerkt; schmal als Overlay (#132) |
| Seitenbaum mit Auf-/Zuklappen, „+“ bei Hover für eine Unterseite, Ziehen zum Verschieben | `TreeNode.vue` | vorhanden |
| Zentrierte Inhaltsspalte, großer Seitentitel, viel Weißraum | `.page`, `--content-width` | vorhanden |
| Kopfzeile mit Breadcrumbs und Seitenmenü | `PageView.vue` | umgesetzt: „Bearbeitet …“, Favorit, Seitenmenü ⋯ (Unterseite, Verlauf, Export, Löschen) (#132) |
| Steuerelemente erscheinen erst bei Hover bzw. Fokus | Blockgriff ⋮⋮ (Klick: Menü mit Umwandeln, Duplizieren, Link kopieren, Verschieben, Löschen; Ziehen: verschieben), „+“ im Baum | umgesetzt (#132/#133) |
| `/` öffnet ein Menü für Blocktypen, Markdown-Kürzel beim Tippen | `SlashMenu.vue`: leerer Block wird umgewandelt, sonst neuer Block danach; Kürzel `#`, `-`, `1.`, `>`, ```` ``` ```` | umgesetzt (#133) |
| Schnellsuche mit `Strg/⌘+K` bzw. `Strg/⌘+P` | `CommandPalette.vue`: zuletzt besuchte Seiten, lokale Volltextsuche (offline), Befehle | umgesetzt (#134) |
| To-do, Toggle, Callout, Trenner | neue Blocktypen | [#135](https://github.com/mszkb/notion-alternative/issues/135) |
| Seiten-Icons (Emoji) und Titelbilder | Dokument-Felder | [#136](https://github.com/mszkb/notion-alternative/issues/136) |
| Hell/Dunkel nach System, manuell umschaltbar | `data-theme`, `src/theme.ts` | umgesetzt (#131) |

## Begriffe

Begriffe wie in Notion, wo es sie gibt: **Seite**, **Unterseite**, **Workspace**, **Favoriten**, **Papierkorb**, **Verlauf**, **Block**. Eigene Begriffe nur für das, was Notion nicht hat: **Offline verfügbar**, **Konflikt**, **Synchronisieren**. Hinweise in Alltagssprache, ohne Fachbegriffe wie „Cursor“ oder „Snapshot“.

## Design-Tokens

Alle Farben, Abstände, Schriftgrößen, Radien und Schatten sind CSS-Variablen in `apps/web/src/styles.css`. Komponenten verwenden nur diese Variablen. Ausnahmen: Abmessungen einzelner Elemente (Breiten, Höhen, Positionen), 1-px-Linien und Größen in `em`, die sich auf den umgebenden Text beziehen.

| Gruppe | Variablen |
| --- | --- |
| Farbe | `--bg`, `--surface`, `--sidebar`, `--text`, `--muted`, `--border`, `--accent`, `--on-accent`, `--error`, `--ok`, `--warn`, `--hover`, `--code-bg` |
| Schatten | `--shadow-popover` (Menüs), `--shadow-toast` (Hinweise am Rand) |
| Abstand | `--space-2xs` (0,15 rem) · `--space-xs` (0,3) · `--space-sm` (0,5) · `--space-md` (0,75) · `--space-lg` (1) · `--space-xl` (1,5) · `--space-2xl` (2) · `--space-3xl` (3) · `--space-4xl` (4) · `--space-5xl` (6) |
| Schrift | `--font-sans` (Systemschrift), `--text-xs`, `--text-sm`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-title` |
| Form | `--radius-sm` (4 px), `--radius` (6 px), `--radius-md` (8 px), `--radius-lg` (12 px), `--radius-pill` |
| Layout | `--sidebar-width`, `--content-width` |

Neue Werte erst als Token anlegen, dann verwenden. Die Systemschrift ist Absicht: keine lizenzierte Schrift, keine Schriftdatei, die offline fehlen könnte.

## Hell und dunkel

- Standard: wie das System (`prefers-color-scheme`).
- Manuell: Konto → Darstellung, oder `Strg/⌘ + Umschalt + L` (#134). Die Wahl gilt pro Gerät und Browser (`localStorage`) und wird vor dem ersten Zeichnen angewendet (`initTheme` in `main.ts`).
- Technisch: `data-theme="light"` bzw. `"dark"` auf `<html>`. Die dunklen Werte stehen einmal für die Systemeinstellung und einmal für die manuelle Wahl; beide Blöcke müssen gleich bleiben.

## Tastenkürzel

Wie in Notion, Übersicht in der App mit `Strg/⌘ + /` (`SHORTCUT_OVERVIEW` in `apps/web/src/shortcuts.ts`).

| Kürzel | Aktion | Konflikt mit dem Browser |
| --- | --- | --- |
| `Strg/⌘ + K` | Schnellsuche; im Text: Link auf eine Seite | Chrome/Firefox: Websuche in der Adressleiste – die App übernimmt es, wie Notion |
| `Strg/⌘ + P` | Schnellsuche, auch im Text | Drucken – die App übernimmt es, wie Notion; Drucken über das Browser-Menü |
| `Strg/⌘ + N` | Neue Seite | Chrome und Firefox geben es Webseiten nicht (neues Fenster). Ersatz: `Strg/⌘ + Alt + N`; in der installierten App je nach Browser auch `Strg/⌘ + N` |
| `Strg/⌘ + \` | Seitenleiste ein-/ausblenden | keiner |
| `Strg/⌘ + Umschalt + L` | Hell/Dunkel | Safari: Seitenleiste des Browsers – die App übernimmt es |
| `Strg/⌘ + /` | Übersicht der Kürzel | keiner |
| `Strg/⌘ + B`, `I`, `E` | Fett, kursiv, Code | Firefox: `B` öffnet sonst die Lesezeichen-Seitenleiste – im Text übernimmt es die App |
| `Strg/⌘ + U` | – | Unterstreichen gibt es nicht (kein Markdown); das Kürzel bleibt beim Browser (Quelltext) |

## Barrierefreiheit

- Textfarben erreichen auf `--bg`, `--surface` und `--sidebar` in beiden Themen mindestens **4,5:1** (WCAG AA). Gemessen am 2026-10-07:

  | Thema | `--text` | `--muted` | `--accent` | `--error` | `--ok` | `--warn` | Text auf `--accent` |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | hell | ≥ 14,3 | ≥ 5,0 | ≥ 4,7 | ≥ 4,9 | ≥ 4,9 | ≥ 4,7 | 5,4 |
  | dunkel | ≥ 13,3 | ≥ 5,6 | ≥ 5,9 | ≥ 4,5 | ≥ 6,6 | ≥ 9,1 | 7,1 |

- Was nur bei Hover erscheint, erscheint auch bei Tastaturfokus (`:focus-visible`, `:focus-within`).
- Jede Aktion ist per Tastatur erreichbar; Menüs schließen mit `Esc`.
- Icons ohne Text haben ein `aria-label`.
