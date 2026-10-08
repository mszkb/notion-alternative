# Seiten bearbeiten

Die Bedienung folgt bekannten Mustern aus Notion ([UX-Leitlinie](../product/ux-guide.md)). Alles funktioniert auch ohne Verbindung; Änderungen werden synchronisiert, sobald der Server erreichbar ist.

## Blöcke

Jede Seite besteht aus Blöcken. Neue Blöcke entstehen mit Enter, mit **„+ Block hinzufügen“** oder über das Menü mit `/`:

| Eingabe am Anfang eines Blocks | Ergebnis |
| --- | --- |
| `/` | Menü mit allen Blocktypen; tippen filtert („über“, „todo“, „code“ …), Pfeiltasten und Enter wählen, Esc schließt |
| `# `, `## `, `### ` | Überschrift 1–3 |
| `- ` oder `* ` | Aufzählung |
| `1. ` | Nummerierte Liste |
| `[] ` | To-do (Kästchen zum Abhaken) |
| `> ` | Zitat |
| ```` ``` ```` | Code |
| `---` | Trennlinie |
| `[[` (irgendwo im Text) | Link auf eine Seite |

Ein leerer Block wird in den gewählten Typ umgewandelt, ein Block mit Text bekommt den neuen Block darunter.

**Toggle:** Ein einklappbarer Abschnitt. Enter im Toggle legt den ersten Inhalt darin an; Tab rückt einen Block in den Toggle ein, Umschalt+Tab oder Backspace am Anfang wieder heraus. Ob ein Toggle auf- oder zugeklappt ist, merkt sich jedes Gerät selbst.

**Hinweis (Callout):** Ein hervorgehobener Kasten mit Symbol; Klick auf das Symbol ändert es.

## Blockgriff ⋮⋮

Links neben jedem Block erscheint bei Hover der Griff:

- **Klicken** öffnet das Blockmenü: umwandeln, duplizieren, Link auf den Block kopieren, nach oben/unten, löschen. Mit Pfeiltasten bedienbar, Esc schließt.
- **Ziehen** verschiebt den Block; ein Toggle nimmt seinen Inhalt mit.

Jeder Schritt lässt sich mit `Strg/⌘ + Z` rückgängig machen.

## Seite gestalten

Über dem Titel erscheinen bei Hover **„Icon hinzufügen“** (Emoji-Auswahl, auch ohne Internet) und **„Titelbild hinzufügen“** (Farbverlauf oder eigenes Bild). Icons erscheinen auch im Seitenbaum, im Pfad und in der Suche. Das Menü **⋯** oben rechts enthält Unterseite anlegen, Verlauf, Export und Löschen.

## Navigation und Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| `Strg/⌘ + K` oder `Strg/⌘ + P` | Schnellsuche: zuletzt besuchte Seiten, Volltext, Befehle |
| `Strg/⌘ + \` | Seitenleiste ein-/ausblenden (Breite: am Rand ziehen) |
| `Strg/⌘ + Alt + N` | Neue Seite (`Strg/⌘ + N` nur, wo der Browser es erlaubt) |
| `Strg/⌘ + Umschalt + L` | Hell/Dunkel umschalten (auch unter Konto → Darstellung) |
| `Strg/⌘ + /` | Übersicht aller Kürzel |
| `Strg/⌘ + B / I / E` | Fett, kursiv, Code |

## Umzug aus Notion

Siehe [Export und Import → Umzug aus Notion](export.md#umzug-aus-notion).
