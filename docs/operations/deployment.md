# Deployment & Betrieb

## Start

Voraussetzung: Docker mit Compose v2.

```sh
cp .env.example .env   # optional anpassen
docker compose up -d --build
```

Die App ist danach unter `http://<host>:8080` erreichbar. Das erste Konto kann sich direkt registrieren.

## Container

| Container | Aufgabe | Daten |
| --- | --- | --- |
| `frontend` | nginx: SPA ausliefern, `/api` an `backend` weiterleiten | – |
| `backend` | Fastify-API | Volume `data` → `/data` (SQLite `app.sqlite`) |

Nur `frontend` veröffentlicht einen Port. Für HTTPS einen TLS-Reverse-Proxy (z. B. Caddy, Traefik) davorschalten und `COOKIE_SECURE=true` setzen.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `8080` | Host-Port der Web-Oberfläche |
| `ALLOW_REGISTRATION` | `false` | Weitere Registrierungen nach dem ersten Konto erlauben |
| `COOKIE_SECURE` | `false` | Session-Cookie nur über HTTPS senden |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, `silent` |

Weitere Backend-Variablen (`SESSION_TTL_DAYS`, `DATA_DIR`, `DATABASE_PATH`): siehe `apps/server/src/config.ts`.

## Healthchecks

- `GET /healthz` – nginx läuft
- `GET /api/health` – Backend-Prozess läuft (Liveness)
- `GET /api/ready` – Datenbank erreichbar (Readiness)

## Migrationen

Datenbank-Migrationen laufen beim Start des Backends automatisch.

## Backup (vorläufig)

Bis zum automatisierten Backup (Phase 7): Backend stoppen, Volume sichern, wieder starten.

```sh
docker compose stop backend
docker run --rm -v notion-alternative_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/backup-$(date +%F).tar.gz -C /data .
docker compose start backend
```

Der Volume-Name hängt vom Compose-Projektnamen ab (`docker volume ls`).
