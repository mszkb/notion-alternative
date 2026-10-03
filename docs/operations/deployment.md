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
- **SD-Karte:** SQLite schreibt regelmäßig; für Dauerbetrieb SSD per USB und [Backup](backup.md).
- **`better-sqlite3`** bringt `linux-arm64`-Binaries im npm-Paket mit, ein Compiler ist nicht nötig. Scheitert der Build mit `node-gyp`, wurde vermutlich das Basis-Image auf Alpine/musl oder eine Version ohne Prebuild umgestellt.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `BIND_ADDRESS` | `127.0.0.1` | Host-Interface der Web-Oberfläche |
| `PORT` | `8080` | Host-Port der Web-Oberfläche |
| `ALLOW_REGISTRATION` | `false` | Weitere Registrierungen nach dem ersten Konto erlauben |
| `COOKIE_SECURE` | `false` | Session-Cookie nur über HTTPS senden |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, `silent` |
| `METRICS_ENABLED` | `false` | Prometheus-Metriken unter `/api/metrics` im Backend bereitstellen |
| `ATTACHMENT_MAX_MB` | `25` | Maximale Größe eines Anhangs (MB = 1 000 000 Byte) (nginx erlaubt für Uploads bis 30 MB; bei höheren Werten `client_max_body_size` in `apps/web/nginx.conf` mit anheben) |
| `ATTACHMENT_RETENTION_DAYS` | `30` | So lange bleibt die Datei eines gelöschten Anhangs erhalten |
| `WORKSPACE_STORAGE_MB` | `2048` | Gesamtgröße der Anhänge pro Konto über alle seine Workspaces (`0` = unbegrenzt); gelöschte Anhänge zählen, bis ihre Datei nach `ATTACHMENT_RETENTION_DAYS` entfernt wird. Darüber lehnt der Server neue Anhänge ab; sie bleiben auf dem Gerät und werden dort markiert. Ein späteres Senken des Werts löscht nichts, verhindert nur neue Anhänge. |
| `IMPORT_MAX_MB` | `50` | Maximale Größe eines Imports (JSON ohne Anhang-Inhalte, die werden einzeln hochgeladen). Es läuft immer nur ein Import gleichzeitig. nginx erlaubt für `/api/import` bis 50 MB; bei höheren Werten `client_max_body_size` in `apps/web/nginx.conf` mit anheben (RAM: grob das Zehnfache der Importgröße einplanen). |
| `PUSH_SUBJECT` | `mailto:admin@localhost` | Kontakt für Web Push (VAPID); eine echte Adresse eintragen, manche Push-Dienste lehnen Platzhalter ab |
| `PUSH_ALLOWED_HOSTS` | Google, Mozilla, Apple, Microsoft | Push-Dienste, an die der Server senden darf (kommagetrennt, `*.` für Subdomains) |

Weitere Backend-Variablen (`SESSION_TTL_DAYS`, `DATA_DIR`, `DATABASE_PATH`, `ATTACHMENTS_DIR`): siehe `apps/server/src/config.ts`.

### Login-Rate-Limiting

Das Backend begrenzt fehlgeschlagene Logins und Registrierungsversuche im Arbeitsspeicher (Zähler gehen bei einem Neustart verloren). Ist ein Limit erreicht, antwortet es mit `429` und `Retry-After`, unabhängig davon, ob das Konto existiert oder das Passwort stimmt. Ein erfolgreicher Login setzt den Zähler der E-Mail-Adresse zurück.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | `15` | Zeitfenster aller Zähler |
| `LOGIN_MAX_FAILURES_PER_EMAIL` | `5` | Fehlversuche je E-Mail-Adresse (gegen Brute Force auf ein Konto) |
| `LOGIN_MAX_FAILURES_PER_IP` | `20` | Fehlversuche je Client-IP (gegen Credential Stuffing) |
| `REGISTER_MAX_ATTEMPTS_PER_IP` | `10` | Registrierungsversuche je Client-IP |

Die Client-IP stammt aus dem letzten Eintrag von `X-Forwarded-For`, den nginx (`frontend`) anhängt; das Backend vertraut genau einem Proxy-Hop. Ein weiterer Reverse Proxy davor (z. B. für TLS) erscheint deshalb als Client-IP; dann teilen sich alle Nutzer das IP-Limit. Abhilfe: [Echte Client-IP hinter einem TLS-Proxy](#echte-client-ip-hinter-einem-tls-proxy) oder `LOGIN_MAX_FAILURES_PER_IP` erhöhen. Bei rootless Docker sieht nginx je nach Port-Treiber ebenfalls nicht die echte Adresse.

## Zugriff von Smartphones (HTTPS)

Für Installation, Offline-Neustart und Web Push auf Smartphones braucht die App HTTPS mit einem vertrauenswürdigen Zertifikat. Vorschlag ([ADR 0011](../adr/0011-https-for-mobile-devices.md), noch `Proposed`):

- **Tailscale (empfohlen, nicht öffentlich):** Tailscale auf Host und Geräten, dann auf dem Host `tailscale serve --bg --https=443 http://127.0.0.1:8080`. Die App ist im Tailnet unter `https://<host>.<tailnet>.ts.net` erreichbar; `BIND_ADDRESS=127.0.0.1` bleibt.
- **Eigener Reverse Proxy mit Let's Encrypt** (öffentlich, eigene Domain): Proxy auf `127.0.0.1:8080` zeigen lassen.

In beiden Fällen `COOKIE_SECURE=true` setzen. Für Web Push muss der Server ausgehend die Push-Dienste erreichen (`PUSH_ALLOWED_HOSTS`).

### Echte Client-IP hinter einem TLS-Proxy

Ohne weitere Einstellung sieht das Backend hinter einem TLS-Proxy für alle Clients dieselbe Adresse (die des Proxys); das Login-Rate-Limiting pro IP gilt dann für alle gemeinsam. Damit nginx die echte Adresse weitergibt, den TLS-Proxy `X-Forwarded-For` setzen lassen und in `apps/web/nginx.conf` im `server`-Block ergänzen (Adresse des Proxys aus Sicht des Containers, z. B. das Docker-Gateway):

```nginx
set_real_ip_from 172.16.0.0/12;
real_ip_header X-Forwarded-For;
```

`real_ip_header X-Forwarded-For` übernimmt den **letzten** Eintrag des Headers, also die Adresse, die der TLS-Proxy angehängt hat (ohne `real_ip_recursive on`, das ist Absicht). nginx gibt sie per `$proxy_add_x_forwarded_for` ans Backend weiter. Das Backend vertraut `X-Forwarded-For` nur von genau einem Proxy-Hop aus einem privaten Netz (dem nginx-Container); ein Client, der das Backend direkt erreicht, kann seine Adresse also nicht vorgeben.

Wichtig: `set_real_ip_from` vertraut **jeder** Verbindung aus dem angegebenen Netz. Veröffentlicht Docker den Port, kommen alle Verbindungen vom Host über das Docker-Gateway, auch solche, die nicht über den TLS-Proxy laufen. Deshalb nur zusammen mit `BIND_ADDRESS=127.0.0.1` verwenden (dann kann nur der Host selbst den Header setzen), nie mit `0.0.0.0`. Prüfen: nach dem Neustart von `frontend` mit einem falschen Passwort anmelden; das Backend-Log (`docker compose logs backend`) zeigt bei der Anfrage die Adresse des Geräts, nicht die des Gateways.

### Was in Logs landet

Das Backend loggt Anfragen ohne Query-String (Suchbegriffe sind Inhalte). nginx protokolliert im Access-Log (`docker compose logs frontend`) dagegen die vollständige URL, also auch Suchbegriffe der serverseitigen Suche; wer das nicht möchte, setzt in `apps/web/nginx.conf` für `location /api/` `access_log off;` oder ein eigenes `log_format` ohne `$request_uri`.

## App offline (Service Worker)

Der Production-Build enthält einen Service Worker (`/sw.js`), der die App-Dateien zwischenspeichert, damit die App auch ohne Netz neu geladen werden kann. Er braucht einen sicheren Kontext: `https://` oder `http://localhost` (z. B. über den SSH-Tunnel). Über eine reine HTTP-LAN-Adresse läuft die App ohne Service Worker weiter, nur das Neuladen offline geht dann nicht ([ADR 0010](../adr/0010-reference-deployment-and-https.md)).

Nach einem Update zeigt die App „Eine neue Version ist verfügbar – Neu laden“; offene Eingaben werden vorher gespeichert. Hängt ein Gerät auf einer alten Version fest: Kontoseite → „App-Cache zurücksetzen“ (lokale Daten bleiben), notfalls in den Browser-Einstellungen die Website-Daten nur für „Cache“/„Service Worker“ löschen.

## Healthchecks

- `GET /healthz` – nginx läuft
- `GET /api/health` – Backend-Prozess läuft (Liveness)
- `GET /api/ready` – Datenbank erreichbar (Readiness)

## Anhänge auf S3-kompatiblem Speicher (optional)

Standardmäßig liegen Dateianhänge im Daten-Volume (`/data/attachments`). Alternativ in einem S3-kompatiblen Bucket (AWS S3, MinIO, Garage, SeaweedFS, Backblaze B2 …), ohne zusätzlichen Container und ohne SDK (Signatur V4 mit `node:crypto`):

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `ATTACHMENT_STORAGE` | `volume` | `s3` schaltet auf den Bucket um |
| `S3_ENDPOINT` | – | z. B. `https://s3.eu-central-1.amazonaws.com` oder `http://minio:9000` |
| `S3_REGION` | `us-east-1` | Region für die Signatur |
| `S3_BUCKET` | – | Bucket (muss existieren) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | – | Zugangsdaten mit Lese-/Schreib-/Löschrecht auf dem Bucket |
| `S3_FORCE_PATH_STYLE` | `true` | `https://host/bucket/key`; für AWS mit virtuellen Hosts `false` |

Fehlen Pflichtangaben, startet das Backend nicht und nennt nur die Variablennamen (Zugangsdaten erscheinen nie in Logs). Metadaten bleiben in SQLite; ein Objekt heißt `<workspace-id>/<anhang-id>` und ändert sich nie.

**Umzug Volume → S3:**

```sh
# 1. S3-Variablen in .env eintragen (ATTACHMENT_STORAGE=s3 …)
docker compose up -d backend
# 2. Bestehende Dateien kopieren und per SHA-256 prüfen (wiederholbar, idempotent)
docker compose exec backend node dist/index.js migrate-attachments-to-s3
# Ausgabe z. B. {"copied":42,"skipped":0,"failed":[]}; bei failed ≠ [] nicht weitermachen
```

Danach liefert das Backend aus dem Bucket. Die alten Dateien unter `/data/attachments` erst löschen, wenn ein Backup des Buckets existiert.

**Backup:** Mit Volume enthält das [Backup](backup.md) alles. Mit S3 gehören **zwei** Teile zusammen: das Backup (SQLite mit Metadaten) und der Bucket (z. B. Versionierung oder `rclone sync`). Beide möglichst zeitnah sichern; fehlende Objekte zeigt die App als „nicht verfügbar“ an, Metadaten ohne Objekt schaden nicht.

## Metriken

Mit `METRICS_ENABLED=true` liefert das Backend unter `GET /api/metrics` Metriken im Prometheus-Textformat:

- `http_requests_total` und `http_request_duration_seconds` je Methode, Routen-Template (z. B. `/api/workspaces/:id`) und Status
- Prozess: `process_resident_memory_bytes`, `process_heap_used_bytes`, `process_uptime_seconds`, `nodejs_eventloop_lag_seconds`
- `sqlite_file_size_bytes` für Datenbank- und WAL-Datei

Labels enthalten keine personenbezogenen Daten, IDs oder konkreten Pfade. nginx (`frontend`) beantwortet `/api/metrics` immer mit `404`; der Endpunkt ist nur im Backend-Container bzw. im internen Docker-Netz erreichbar. Einmalig abrufen:

```sh
docker compose exec backend node -e "fetch('http://127.0.0.1:3000/api/metrics').then(r => r.text()).then(console.log)"
```

Einen Prometheus-Server betreibt das Projekt bewusst nicht (genau zwei Container, ADR 0006); ein vorhandener Prometheus kann das Backend über ein gemeinsames Docker-Netz abfragen.

## Migrationen

Datenbank-Migrationen laufen beim Start des Backends automatisch und nur vorwärts; vor jedem Update ein Backup ziehen ([Upgrade](backup.md#upgrade)).

## Backup und Restore

Backup im laufenden Betrieb, Restore, Automatisierung (cron/systemd), Off-site-Kopie, Prüfung und Upgrade: [`backup.md`](backup.md). Kurzfassung:

```sh
docker compose exec -T backend node dist/index.js backup       # -> /data/backups/backup-<Zeit>
docker compose cp backend:/data/backups/backup-<Zeit> ~/notion-alt-backups/
```

Mit `ATTACHMENT_STORAGE=s3` den Bucket zusätzlich sichern; `.env` liegt auf dem Host und gehört nicht zum Backup.
