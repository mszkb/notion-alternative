# 0016 – Start ohne Docker

- **Status:** Accepted
- **Datum:** 2026-10-04

## Kontext

Die Positionierung ist ein super einfaches, minimalistisches self-hosted Werkzeug ([`vision.md`](../product/vision.md#einfachheitsbudget)). Viele Alternativen brauchen mehrere Container und Dienste. Bisher setzte auch dieses Projekt für den Betrieb Docker voraus ([ADR 0006](0006-tech-stack.md)): Der `frontend`-Container ist nginx, der die SPA ausliefert, `/api` an das Backend weiterleitet und Sicherheits-Header setzt. Ohne Docker gab es nur `pnpm dev` (Vite im Watch-Modus), das nicht für den Betrieb gedacht ist.

Ziel des Maintainers: **Frontend starten, Backend starten, loslegen** – mit nichts als Node.

## Entscheidung

- Neben Docker Compose gibt es einen gleichwertigen Start ohne Docker:

  ```sh
  pnpm install && pnpm build
  pnpm start:backend    # Fastify-API auf 127.0.0.1:3000
  pnpm start:frontend   # App auf http://127.0.0.1:8080
  ```

- Das Frontend ohne Docker ist `apps/web/serve.mjs`: ein kleiner Node-Server **ohne Abhängigkeiten**. Er übernimmt die Aufgaben von `nginx.conf`: Build ausliefern mit denselben Cache-Regeln, SPA-Fallback, `/api` ans Backend weiterleiten (`X-Forwarded-For`, `/api/metrics` gesperrt), dieselben Sicherheits-Header (gelesen aus `security-headers.conf`), `/healthz`.
- Die Aufteilung in zwei Prozesse bleibt dieselbe wie bei den zwei Containern. Docker Compose bleibt der Weg mit Härtung (read-only, `cap_drop`).
- Beide Prozesse lauschen ohne Docker standardmäßig nur auf Loopback (wie [ADR 0010](0010-reference-deployment-and-https.md)). Der Standard von `HOST` im Backend ist deshalb jetzt `localhost`; das Docker-Image setzt weiterhin `HOST=0.0.0.0` im Container.

## Begründung

- Ein Node-Server statt nginx: Node ist ohnehin installiert, nginx wäre eine zusätzliche Systemabhängigkeit mit eigener Konfiguration.
- Keine neue Bibliothek (z. B. `@fastify/static`, `http-proxy`): Statische Dateien und ein Proxy sind mit `node:http` in rund 150 Zeilen machbar und testbar.
- Die SPA nicht vom Backend ausliefern lassen: Das hielte die Trennung `frontend`/`backend` aus ADR 0006 nicht ein und würde Docker- und Node-Betrieb auseinanderlaufen lassen.

## Konsequenzen

- `nginx.conf` und `serve.mjs` müssen dieselben Regeln haben. Ändert sich eine, wird die andere angepasst; `serve.test.mjs` prüft Cache-Regeln, Header und Proxy.
- Body-Größen begrenzt ohne Docker nur das Backend (Fastify-Limits, `ATTACHMENT_MAX_MB`, `IMPORT_MAX_MB`), nicht der Proxy.
- Für Dauerbetrieb ohne Docker braucht es einen Prozessmanager (z. B. systemd); Beispiel in [`deployment.md`](../operations/deployment.md#start-ohne-docker).
- Daten liegen ohne Docker standardmäßig in `apps/server/data/` (`DATA_DIR`).
