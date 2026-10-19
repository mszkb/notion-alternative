# 0025 – Website mit Landing Page und Dokumentation

- **Status:** Accepted
- **Datum:** 2026-10-19

## Kontext

Die Dokumentation liegt als Markdown in `docs/` und ist bisher nur auf GitHub lesbar. Die Anleitungen für Nutzer (Webspace, FTP, Hoster) richten sich an weniger technikaffine Umsteiger ([Vision](../product/vision.md)); für sie ist eine Website mit Navigation und Suche zugänglicher als ein Repository. Außerdem ist eine eigene Landing Page geplant, die das Projekt vorstellt und zur Installation führt. Die Markdown-Dateien sollen auf GitHub lesbar bleiben und ihre relativen Links behalten.

## Optionen

1. **VitePress** – Vite und Vue wie die Web-App, rendert vorhandenes Markdown ohne Umbau. Eine frei gestaltete Landing Page passt aber nur umständlich in das Doku-Theme.
2. **Astro mit Starlight** – Landing Page als normale Astro-Seite und Doku mit Starlight in einem Projekt, statisches HTML, Suche (Pagefind) ohne externen Dienst, deutsche Oberfläche eingebaut. Starlight verlangt einen Titel im Front Matter und schreibt Links nicht um; das übernimmt ein kleines Skript.
3. **MkDocs (Material)** – gute Doku, braucht aber Python in der Toolchain und taugt nicht für die Landing Page.
4. **Nur GitHub** – kein Aufwand, aber keine Suche, keine Navigation, keine Landing Page.

## Entscheidung

Astro mit Starlight im Paket `@notion-alt/site` (`apps/site`), auf Wunsch des Maintainers, weil Landing Page und Doku zusammengehören:

- `/` ist die Landing Page (`apps/site/src/pages/index.astro`), `/docs/` die Dokumentation.
- `docs/` bleibt die einzige Quelle, ohne Front Matter. `apps/site/scripts/sync-docs.mjs` kopiert die Dateien vor jedem Build in Starlights Content-Ordner (nicht eingecheckt): Titel aus der ersten Überschrift, `README.md` als Startseite des Ordners, relative Links auf Seiten-URLs, Links aus `docs/` hinaus und auf Nicht-Markdown-Dateien auf GitHub. Ein Link auf eine fehlende Datei lässt den Build scheitern.
- Die Reihenfolge in der Seitenleiste steht in `ORDER` im Skript; nicht aufgeführte Dateien folgen nach Namen.
- Veröffentlicht wird über GitHub Pages aus `main` (`.github/workflows/site.yml`), unter `https://mszkb.github.io/notion-alternative/`. Pull Requests, die `docs/` oder `apps/site/` ändern, bauen die Seite nur. Eine eigene Domain geht über `SITE_URL` und `SITE_BASE`.

## Konsequenzen

- Neue Dokumente erscheinen automatisch in ihrem Ordner; ein neuer Ordner muss in die Seitenleiste in `apps/site/astro.config.mjs`.
- Die Seite ist öffentlich wie das Repository. Nichts in `docs/` ablegen, was nicht öffentlich sein soll.
- In den Repository-Einstellungen muss einmalig **Pages → Source → GitHub Actions** gesetzt werden.
- Die Landing Page nutzt die Farben der App (`apps/web/src/styles.css`), aber eigenes CSS; Änderungen an den Tokens dort von Hand nachziehen.
- Web-App und Release-ZIP sind unabhängig von der Website.
