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

## Raspberry Pi

Referenzgerät ist ein Raspberry Pi 4 mit 64-Bit-OS ([ADR 0010](../adr/0010-raspberry-pi-and-lan-https.md), Proposed). Die Images werden auf dem Pi selbst gebaut; die CI prüft den `linux/arm64`-Build bei jedem Push.

Voraussetzungen:

- 64-Bit-System: `uname -m` muss `aarch64` liefern (32-Bit-Raspberry-Pi-OS wird nicht unterstützt).
- Mindestens 2 GB RAM **und aktiver Swap**: Beim Build waren auf einem Pi 4 mit 2 GB bis zu 1,4 GiB belegt, mit über 300 MiB Swap.
- Docker mit Compose v2 (rootful oder rootless). Etwa 1 GB freier Speicher für Images und Build-Cache.

```sh
git clone https://github.com/mszkb/notion-alternative.git ~/notion-alternative
cd ~/notion-alternative
cp .env.example .env
# Nur im vertrauenswürdigen LAN, ohne TLS (siehe unten):
sed -i 's/^BIND_ADDRESS=.*/BIND_ADDRESS=0.0.0.0/' .env
docker compose up -d --build   # erster Build ≈ 5 min auf einem Pi 4
curl -fsS http://<pi-ip>:8080/healthz
curl -fsS http://<pi-ip>:8080/api/ready
```

Stolpersteine:

- **Port belegt:** Läuft schon etwas auf 8080 (oder 80/443 für einen späteren Proxy), `PORT` in `.env` ändern. Prüfen mit `ss -ltn`.
- **Kein HTTPS über `http://<pi-ip>`:** Kein sicherer Kontext, deshalb „Speicher nicht dauerhaft“, ab Phase 4 auch kein Service Worker und kein Web Push. Die Optionen stehen in ADR 0010; bis zur Entscheidung nur zum Testen im LAN verwenden.
- **`docker stats` zeigt keinen Speicher** und `mem_limit` greift nicht, wenn der Kernel mit `cgroup_disable=memory` startet (Standard bei vielen Pi-Images). Aktivieren: `cgroup_enable=memory` an `/boot/firmware/cmdline.txt` anhängen, neu starten. Ohne diese Änderung den RAM mit `free -m` beobachten.
- **Rootless Docker:** Funktioniert; Ports unter 1024 brauchen zusätzliche Konfiguration. Das Backend sieht je nach Port-Treiber nicht die echte Client-IP.
- **SD-Karte:** SQLite schreibt regelmäßig. Für den Dauerbetrieb SSD per USB empfehlen und das Backup unten einrichten.
- **`better-sqlite3`:** Bringt `linux-arm64`-Binaries im npm-Paket mit, ein Compiler ist nicht nötig. Scheitert der Build trotzdem mit `node-gyp`, wurde vermutlich das Basis-Image auf Alpine/musl oder eine Version ohne Prebuild umgestellt.

### Auf einem öffentlich erreichbaren Server (VPS)

`BIND_ADDRESS` auf `127.0.0.1` lassen. Von Docker veröffentlichte Ports umgehen `ufw`, `0.0.0.0` stünde also direkt im Internet. Zum Testen per SSH-Tunnel zugreifen; `http://localhost` ist im Browser ein sicherer Kontext:

```sh
ssh -N -L 8080:127.0.0.1:8080 <server>
```

Dafür muss der SSH-Server lokales Forwarding erlauben (`AllowTcpForwarding local`, ggf. nur per `Match User …` und `PermitOpen 127.0.0.1:8080`). Öffentlich freigeben erst mit TLS und Login-Rate-Limiting.

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
