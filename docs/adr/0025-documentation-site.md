# 0025 – Dokumentation als Website

- **Status:** Accepted
- **Datum:** 2026-10-19

## Kontext

Die Dokumentation liegt als Markdown in `docs/` und ist bisher nur auf GitHub lesbar. Die Anleitungen für Nutzer (Webspace, FTP, Hoster) richten sich an weniger technikaffine Umsteiger ([Vision](../product/vision.md)); für sie ist eine Website mit Navigation und Suche zugänglicher als ein Repository. Die Dateien sollen dabei auf GitHub lesbar bleiben und ihre relativen Links behalten.

## Optionen

1. **VitePress** – Vite und Vue wie die Web-App, rendert vorhandenes Markdown ohne Umbau, lokale Suche ohne externen Dienst, statisches HTML. Nachteil: eine weitere Entwicklungsabhängigkeit.
2. **MkDocs (Material)** – verbreitet, gute Suche; braucht Python in der Toolchain, die sonst ohne auskommt.
3. **Docusaurus** – React, deutlich schwerer, für einen Docs-Ordner überdimensioniert.
4. **Nur GitHub** – kein Aufwand, aber keine Suche und keine Navigation für Nutzer.

## Entscheidung

VitePress (auf Wunsch des Maintainers), als Paket `@notion-alt/docs` direkt in `docs/` (`docs/package.json`, Konfiguration in `docs/.vitepress/config.mts`):

- Die Markdown-Dateien bleiben unverändert, ohne Front Matter. Die Seitenleiste nimmt die Titel aus der ersten Überschrift; `README.md` wird zur Startseite des Ordners.
- Links aus `docs/` hinaus (Quellcode, `ROADMAP.md`) und auf Nicht-Markdown-Dateien zeigen auf GitHub.
- Tote Links zwischen den Seiten lassen den Build scheitern.
- Veröffentlicht wird über GitHub Pages aus `main` (`.github/workflows/docs.yml`), unter `https://mszkb.github.io/notion-alternative/`. Pull Requests, die `docs/` ändern, bauen die Seite nur.

## Konsequenzen

- Neue Dokumente erscheinen automatisch in der Seitenleiste ihres Ordners; ein neuer Ordner muss in `config.mts` eingetragen werden.
- Die Seite ist öffentlich wie das Repository. Nichts in `docs/` ablegen, was nicht öffentlich sein soll.
- In den Repository-Einstellungen muss einmalig **Pages → Source → GitHub Actions** gesetzt werden.
- Die Web-App und die Releases sind davon unabhängig; die Dokumentation wird nicht in die App oder das Release-ZIP eingebaut.
