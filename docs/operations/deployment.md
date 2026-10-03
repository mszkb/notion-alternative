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

## Server mit SSH-Tunnel (Referenz)

Referenz-Deployment ist ein Linux-Host mit Docker, auf dem die App nur auf Loopback lauscht ([ADR 0010](../adr/0010-reference-deployment-and-https.md)). Zugriff vom eigenen Rechner per SSH-Tunnel. `http://localhost` ist im Browser ein sicherer Kontext, Service Worker und Web Push funktionieren damit auch in der Entwicklung.

```sh
git clone https://github.com/mszkb/notion-alternative.git ~/notion-alternative
cd ~/notion-alternative
cp .env.example .env            # BIND_ADDRESS=127.0.0.1 beibehalten
docker compose up -d --build --wait
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/ready
```

Auf dem eigenen Rechner, danach `http://localhost:8080` öffnen:

```sh
ssh -N -L 127.0.0.1:8080:127.0.0.1:8080 <server>
```

Stolpersteine:

- **`BIND_ADDRESS=0.0.0.0` nicht auf Hosts mit öffentlicher IP:** Von Docker veröffentlichte Ports umgehen `ufw`, die App stünde direkt im Internet. Öffentlich freigeben erst mit TLS und Login-Rate-Limiting.
- **`administratively prohibited: open failed` beim Tunnel:** Der SSH-Server verbietet Forwarding. Eng begrenzt erlauben, und zwar am **Ende** von `/etc/ssh/sshd_config`. Drop-ins in `sshd_config.d/` wirken nur, wenn die Datei sie per `Include` einbindet. Danach `sudo sshd -t && sudo systemctl reload ssh`:

  ```text
  Match User <user>
      AllowTcpForwarding local
      PermitOpen 127.0.0.1:8080
  ```

- **Port belegt:** Läuft schon etwas auf 8080, `PORT` in `.env` ändern (ebenso im Tunnel und bei `PermitOpen`). Prüfen mit `ss -ltn`.
- **„Speicher nicht dauerhaft“ trotz `localhost`:** Der Browser gewährt `persist()` heuristisch, z. B. nach Installation als App (Phase 4). Kein Fehler des Deployments.
- **Andere Geräte (Smartphone):** Über den Tunnel nicht praktikabel; HTTPS dafür wird in Phase 4 entschieden (ADR 0010).

### Raspberry Pi / arm64

Die Images bauen auch für `linux/arm64`; die CI prüft das bei jedem Push. Auf einem Raspberry Pi 4 mit 2 GB wurde der Build gemessen (≈ 5 min kalt). Betrieb und Tests dort gehören nicht zum Referenz-Deployment.

- 64-Bit-System nötig: `uname -m` muss `aarch64` liefern.
- Mindestens 2 GB RAM **und aktiver Swap**: Beim Build waren bis zu 1,4 GiB belegt, mit über 300 MiB Swap.
- **`docker stats` zeigt keinen Speicher** und `mem_limit` greift nicht, wenn der Kernel mit `cgroup_disable=memory` startet (bei vielen Pi-Images Standard). Abhilfe: `cgroup_enable=memory` an `/boot/firmware/cmdline.txt` anhängen und neu starten.
- **Rootless Docker** funktioniert; das Backend sieht je nach Port-Treiber nicht die echte Client-IP.
- **SD-Karte:** SQLite schreibt regelmäßig; für Dauerbetrieb SSD per USB und Backup (unten).
- **`better-sqlite3`** bringt `linux-arm64`-Binaries im npm-Paket mit, ein Compiler ist nicht nötig. Scheitert der Build mit `node-gyp`, wurde vermutlich das Basis-Image auf Alpine/musl oder eine Version ohne Prebuild umgestellt.

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
