# notion-alternative

Self-hosted, local-first Notion-Alternative mit installierbarer PWA. **Work in progress**, siehe [Roadmap](ROADMAP.md).

Notion nervt mit seinem „always on“. Ja, es gibt eine Offline-Funktion, aber die ist ein bisschen useless. Self-hosted Alternativen gibt es kaum so wirklich, und wenn, dann ist auch die iOS-App mist.

## Schnellstart

```sh
docker compose up -d --build
```

Oder ganz ohne Docker, nur mit Node 22:

```sh
corepack enable && pnpm install && pnpm build
pnpm start:backend    # Terminal 1
pnpm start:frontend   # Terminal 2
```

Dann `http://127.0.0.1:8080` öffnen und das erste Konto anlegen. Details: [Deployment & Betrieb](docs/operations/deployment.md).

## Entwicklung

```sh
corepack enable
pnpm install
pnpm dev        # Server :3000, Web :5173
pnpm test
pnpm --filter @notion-alt/web test:e2e   # Playwright, startet Server und Vite selbst
```

Stand: Der lokale Editor (Phase 2) funktioniert vollständig offline; Inhalte bleiben bis zum Sync (Phase 3) nur im Browser des Geräts.

Mehr in [`CLAUDE.md`](CLAUDE.md) und unter [`docs/`](docs/README.md).

## Lizenz

[MIT](LICENSE)
