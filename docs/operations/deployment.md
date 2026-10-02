# Deployment & Betrieb

## Start

Voraussetzung: Docker mit Compose v2.

```sh
cp .env.example .env   # optional anpassen
docker compose up -d --build
```

Die App ist danach auf dem Host unter `http://127.0.0.1:8080` erreichbar. Das erste Konto kann sich direkt registrieren.

## Container

| Container | Aufgabe | Daten |
| --- | --- | --- |
| `frontend` | nginx: SPA ausliefern, `/api` an `backend` weiterleiten | – |
| `backend` | Fastify-API | Volume `data` → `/data` (SQLite `app.sqlite`) |

Nur `frontend` veröffentlicht einen Port, standardmäßig **nur auf `127.0.0.1`**. Für den Zugriff von anderen Geräten einen TLS-Reverse-Proxy (z. B. Caddy, Traefik) auf dem Host davorschalten und `COOKIE_SECURE=true` setzen. HTTPS ist auch Voraussetzung für die PWA (Service Worker, Web Push).

`BIND_ADDRESS=0.0.0.0` macht die App ohne TLS im ganzen Netz erreichbar – Passwörter und Session-Cookies gehen dann im Klartext über das Netz. Nur in vertrauenswürdigen Netzen und zum Testen verwenden.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `BIND_ADDRESS` | `127.0.0.1` | Host-Interface der Web-Oberfläche |
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

> **Wichtig bis Phase 3 (Sync):** Seiteninhalte liegen nur lokal im Browser (IndexedDB) des jeweiligen Geräts und werden noch nicht zum Server übertragen. Das Server-Backup enthält deshalb nur Konten und Workspaces. Abmelden löscht die lokalen Daten nicht; das Löschen der Website-Daten im Browser schon. Die Seitenleiste zeigt, ob der Browser den Speicher dauerhaft gewährt hat.

Bis zum automatisierten Backup (Phase 7): Backend stoppen, Volume sichern, wieder starten. Im Verzeichnis mit der `docker-compose.yml` ausführen:

```sh
set -eu
# Resolve the volume actually mounted at /data by the backend container.
container=$(docker compose ps -aq backend)
[ -n "$container" ] || { echo "backend container not found" >&2; exit 1; }
volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container")
[ -n "$volume" ] && docker volume inspect "$volume" >/dev/null || { echo "data volume not found" >&2; exit 1; }

docker compose stop backend
docker run --rm -v "$volume":/data:ro -v "$PWD":/backup alpine \
  tar czf "/backup/backup-$(date +%F).tar.gz" -C /data .
docker compose start backend
```
