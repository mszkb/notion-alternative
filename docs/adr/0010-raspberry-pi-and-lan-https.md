# 0010 – Raspberry Pi als Referenzgerät und HTTPS im LAN

- **Status:** Proposed
- **Datum:** 2026-10-03

## Kontext

Zielgerät für Self-hosted Einzelanwender ist ein Raspberry Pi im Heimnetz. Bisher wurden die Images nur in der CI auf x86 gebaut. Zwei Fragen sind offen:

1. Läuft der Stack aus [ADR 0006](0006-tech-stack.md) unverändert auf `linux/arm64`, und wie stellen wir sicher, dass das so bleibt?
2. Über `http://<pi-ip>` hat der Browser **keinen sicheren Kontext**. Dann fehlen `navigator.storage.persist()` (Seitenleiste zeigt „nicht dauerhaft“) und `crypto.randomUUID()` (Fallback existiert, ADR 0009). Ab Phase 4 brauchen Service Worker und Web Push zwingend HTTPS (Ausnahme nur `localhost`). Ein Reverse Proxy als **dritter Container** widerspricht ADR 0006 (genau zwei Container).

## Messwerte

Gemessen am 2026-10-02/03 mit Stand `681b077` (main nach Phase 2).

| | Raspberry Pi 4 Model B, 2 GB | VPS (netcup, KVM) |
| --- | --- | --- |
| Architektur / OS | `aarch64`, Debian 13 (trixie), Kernel 6.18 | `x86_64`, Debian 13, Kernel 6.12 |
| CPU / RAM | 4 Kerne / 1,8 GiB + 1,8 GiB Swap | 4 vCPU / 7,8 GiB |
| Docker | 29.8, **rootless**, Compose v5.6, ohne Memory-Cgroup | 29.1, Compose v5.0 |
| Build (`docker compose build`, kalt, inkl. Basis-Images) | **≈ 4 min 36 s** | 26 s |
| davon `pnpm install` backend / frontend (parallel) | 72 s / 72 s | – |
| davon `pnpm deploy --prod` (backend) | 59 s | – |
| RAM während des Builds (ganzes System, anderer Stack lief mit) | Spitze 1,37 GiB belegt, min. 472 MiB verfügbar, Swap bis 353 MiB | unkritisch |
| Image-Größe backend / frontend | 415 MB / 92 MB | 396 MB / 93 MB |
| RAM im Betrieb (`docker stats`) backend / frontend | noch nicht gemessen¹ | 33–42 MiB / 10 MiB |
| `better-sqlite3` | Prebuild `linux-arm64` aus dem npm-Paket, kein Compiler nötig | Prebuild `linux-x64` |
| Smoke-Test `/healthz`, `/api/ready` | ausstehend¹ | ok |
| Browser: Konto, Seite mit Text, Liste, Code, Seitenlink, Neuladen | ausstehend¹ | ok |
| T-OFF-01/T-OFF-02 (Backend gestoppt, lesen und bearbeiten, neu laden) | ausstehend¹ | ok |

¹ Der Pi war während der Session anderweitig belegt; Build lief durch, Start und Tests werden nachgeholt. `docker stats` zeigt auf dem Pi ohnehin keinen Speicher pro Container, solange der Kernel mit `cgroup_disable=memory` startet.

Erkenntnisse:

- **`better-sqlite3` 13 liefert die nativen Binaries im npm-Paket mit** (`prebuilds/linux-arm64.node`, glibc). Es gibt kein Install-Skript; deshalb muss es nicht in `onlyBuiltDependencies` stehen und das Image braucht keinen Compiler. Voraussetzung: glibc-Basis-Image (`bookworm-slim`); bei Alpine würde `linuxmusl-arm64` greifen.
- Der Build ist auf dem Pi 4 mit 2 GB machbar, aber knapp, wenn andere Dienste laufen. Swap muss aktiv sein.
- `localhost` (z. B. per SSH-Tunnel) ist ein sicherer Kontext, `persist()` wurde trotzdem nicht gewährt. Chromium entscheidet heuristisch (Installation als App, Lesezeichen, Interaktion). HTTPS ist also notwendig, aber nicht hinreichend; die Installation als PWA (Phase 4) ist der eigentliche Hebel.

## Optionen für HTTPS im LAN

1. **Tailscale HTTPS (`tailscale serve`) auf dem Host, außerhalb von Compose.** Der Host bekommt `<name>.<tailnet>.ts.net` mit öffentlich vertrauenswürdigem Let's-Encrypt-Zertifikat; `serve` terminiert TLS und leitet an `127.0.0.1:8080`. **+** Kein dritter Container, keine eigene CA auf den Clients (wichtig für iOS/Android-PWA und Web Push), gleiche Lösung für Pi und VPS, nicht aus dem Internet erreichbar, `BIND_ADDRESS` bleibt `127.0.0.1`. **−** Jeder Client braucht die Tailscale-App; Abhängigkeit vom Koordinationsdienst eines Drittanbieters (Datenpfad bleibt direkt, die App selbst ist local-first); der Hostname landet in den öffentlichen Certificate-Transparency-Logs. Auf dem Pi ist 443 schon belegt, dort ggf. `--https=8443`.
2. **TLS direkt im `frontend`-nginx, Zertifikat von außen eingebunden** (mkcert, `tailscale cert` oder ACME per DNS-01). **+** Bleibt bei zwei Containern; unabhängig von der Herkunft des Zertifikats. **−** Änderung an `nginx.conf` und `docker-compose.yml` (zweiter Port, Volume für Zertifikat); Erneuerung und Reload außerhalb des Containers; mit mkcert muss die eigene CA auf **jedem** Gerät vertraut werden (iOS: Profil plus „volles Vertrauen“, Firefox: eigener Speicher).
3. **Caddy mit interner CA als Host-Dienst (apt), außerhalb von Compose.** **+** Automatische Zertifikate, einfache Konfiguration. **−** Gleiche CA-Verteilung wie bei mkcert; ein weiterer Dienst auf dem Host; kollidiert, wenn 80/443 schon belegt sind (auf dem Pi der Fall).
4. **Caddy/Traefik als dritter Compose-Service.** **+** Alles in einem `docker compose up`. **−** Widerspricht ADR 0006, bräuchte ein eigenes ADR, das 0006 ablöst.
5. **Eigene Domain, Let's Encrypt per DNS-01, Split-DNS auf die LAN-IP.** **+** Vertrauenswürdig auf allen Geräten ohne Client-Software. **−** Domain und DNS-API-Token nötig, Erneuerung einrichten; technisch Variante von 2 oder 3.

Nicht in Frage kommt, den Dienst öffentlich ins Internet zu stellen (z. B. per Traefik auf dem VPS), solange Login-Rate-Limiting fehlt (Phase 1, offen).

## Entscheidung

**Vorschlag (noch nicht entschieden):**

- **Raspberry Pi 4 (arm64, ≥ 2 GB RAM) ist Referenzgerät.** Die CI baut beide Images zusätzlich für `linux/arm64` (buildx + QEMU, ohne Push) und lädt `better-sqlite3` einmal unter arm64.
- **HTTPS: Option 1 (Tailscale serve) als empfohlener Weg**, Option 2 mit mkcert als dokumentierte Alternative ohne Drittanbieter. Beide halten die zwei Container aus ADR 0006 ein.

## Konsequenzen

- Neue Abhängigkeiten im Image müssen arm64-Prebuilds haben oder ohne Compiler auskommen; der CI-Job `docker-arm64` fällt sonst auf.
- Der arm64-Build in der CI läuft unter QEMU und ist deutlich langsamer als der x86-Build (Layer-Cache über GitHub Actions). Alternative bei Bedarf: native `ubuntu-24.04-arm`-Runner.
- Nach Entscheidung: `docs/operations/deployment.md` um die gewählte HTTPS-Variante ergänzen, `COOKIE_SECURE=true` setzen; bei Option 2 `nginx.conf`/Compose anpassen.
- Ausstehend: Start, Smoke-Test, Browser-Test und T-OFF-01/02 auf dem Pi sowie RAM im Betrieb nachtragen.
- Hinter rootless Docker (Pi) sieht das Backend bei veröffentlichten Ports nicht unbedingt die echte Client-IP. Das ist beim Login-Rate-Limiting (Phase 1) zu berücksichtigen.
