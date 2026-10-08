# 0010 – Referenz-Deployment und HTTPS

- **Status:** Accepted, Server-Teil superseded by 0018
- **Datum:** 2026-10-03


> **Teilweise ersetzt:** Der Teil „Referenz-Deployment nur mit Docker“ ist durch [ADR 0018](0018-php-backend.md) (PHP-Backend, angenommen 2026-10-08) ersetzt. Bis zur Umstellung ([#129](https://github.com/mszkb/notion-alternative/issues/129)) läuft weiter der Node-Server.

## Kontext

Bisher wurden die Images nur in der CI auf x86 gebaut und nie auf einem echten Host betrieben. Offen waren:

1. Auf welchem Host wird der Stack aus [ADR 0006](0006-tech-stack.md) regelmäßig betrieben und getestet, und läuft er auch auf `linux/arm64` (Raspberry Pi)?
2. Über `http://<host-ip>` hat der Browser **keinen sicheren Kontext**. Dann fehlen `navigator.storage.persist()` (Seitenleiste zeigt „nicht dauerhaft“) und `crypto.randomUUID()` (Fallback existiert, ADR 0009). Ab Phase 4 brauchen Service Worker und Web Push zwingend einen sicheren Kontext. Ein Reverse Proxy als **dritter Container** widerspricht ADR 0006 (genau zwei Container).

Ursprünglich war ein Raspberry Pi als Referenzgerät vorgesehen. Er ist anderweitig belegt; der Build wurde dort einmal gemessen, Betrieb und Tests laufen auf einem VPS.

## Messwerte

Gemessen am 2026-10-02/03 mit Stand `681b077` (main nach Phase 2).

| | VPS (netcup, KVM) | Raspberry Pi 4 Model B, 2 GB |
| --- | --- | --- |
| Architektur / OS | `x86_64`, Debian 13, Kernel 6.12 | `aarch64`, Debian 13 (trixie), Kernel 6.18 |
| CPU / RAM | 4 vCPU / 7,8 GiB | 4 Kerne / 1,8 GiB + 1,8 GiB Swap |
| Docker | 29.1, Compose v5.0 | 29.8, rootless, Compose v5.6, ohne Memory-Cgroup |
| Build (`docker compose build`) | 26 s | **≈ 4 min 36 s** kalt inkl. Basis-Images (`pnpm install` 72 s, `pnpm deploy --prod` 59 s) |
| RAM während des Builds (ganzes System) | unkritisch | Spitze 1,37 GiB belegt, min. 472 MiB verfügbar, Swap bis 353 MiB |
| Image-Größe backend / frontend | 396 MB / 93 MB | 415 MB / 92 MB |
| RAM im Betrieb (`docker stats`) backend / frontend | 33–42 MiB / 10 MiB | nicht gemessen |
| `better-sqlite3` | Prebuild `linux-x64` | Prebuild `linux-arm64` aus dem npm-Paket, kein Compiler nötig |
| Smoke-Test `/healthz`, `/api/ready` | ok | nicht durchgeführt |
| Browser: Konto, Seite mit Text, Liste, Code, Seitenlink, Neuladen | ok (per SSH-Tunnel) | nicht durchgeführt |
| T-OFF-01/T-OFF-02 (Backend gestoppt, lesen und bearbeiten, neu laden) | ok | nicht durchgeführt |

Erkenntnisse:

- **`better-sqlite3` 13 liefert die nativen Binaries im npm-Paket mit** (`prebuilds/<plattform>.node`, u. a. `linux-arm64`, glibc). Es gibt kein Install-Skript; deshalb muss es nicht in `onlyBuiltDependencies` stehen und das Image braucht keinen Compiler. Voraussetzung: glibc-Basis-Image (`bookworm-slim`); bei Alpine würde `linuxmusl-*` greifen.
- Von Docker veröffentlichte Ports umgehen `ufw`. Auf einem Host mit öffentlicher IP ist `BIND_ADDRESS=0.0.0.0` damit direkt im Internet.
- `http://localhost` (per SSH-Tunnel) ist ein sicherer Kontext. `persist()` wurde trotzdem nicht gewährt: Chromium entscheidet heuristisch (Installation als App, Lesezeichen, Interaktion). Der eigentliche Hebel ist die Installation als PWA (Phase 4).

## Optionen

Zugriff auf den Referenz-Host:

1. **`BIND_ADDRESS=127.0.0.1`, Zugriff per SSH-Tunnel** (`ssh -L`). **+** Nichts öffentlich erreichbar, kein Zertifikat, sicherer Kontext im Browser des Entwicklungsrechners; reicht für Service Worker und Web Push in der Entwicklung. **−** Nur von Geräten mit SSH-Zugang; Smartphones praktisch ausgeschlossen.
2. **Öffentlich über einen vorhandenen Reverse Proxy (z. B. Traefik) mit Let's Encrypt.** **+** Echte Zertifikate, alle Geräte. **−** Aus dem Internet erreichbar; ausgeschlossen, solange Login-Rate-Limiting fehlt.

HTTPS für weitere Geräte (Smartphone, Tablet), für Phase 4:

3. **Tailscale HTTPS (`tailscale serve`) auf dem Host, außerhalb von Compose.** **+** Öffentlich vertrauenswürdiges Zertifikat ohne eigene CA (wichtig für iOS/Android-PWA und Web Push), kein dritter Container, nicht im Internet. **−** Tailscale-App auf jedem Client; Koordinationsdienst eines Drittanbieters; Hostname in Certificate-Transparency-Logs.
4. **TLS im `frontend`-nginx, Zertifikat von außen** (mkcert, `tailscale cert`, ACME per DNS-01). **+** Bleibt bei zwei Containern. **−** Änderung an `nginx.conf`/Compose, Erneuerung außerhalb; mit mkcert muss die CA auf jedem Gerät vertraut werden.
5. **Caddy mit interner CA als Host-Dienst** oder **als dritter Compose-Service.** **−** CA-Verteilung wie bei mkcert; der dritte Container widerspräche ADR 0006.

## Entscheidung

- **Referenz-Deployment ist ein Linux-Host (derzeit VPS, x86_64) mit `BIND_ADDRESS=127.0.0.1`; Zugriff per SSH-Tunnel (Option 1).** Manuelle Smoke- und Offline-Tests laufen dort.
- **`linux/arm64` bleibt unterstützt:** Die CI baut beide Images zusätzlich für `linux/arm64` (buildx + QEMU, ohne Push) und lädt `better-sqlite3` einmal unter arm64. Der Pi-Build oben ist die Referenzmessung.
- **HTTPS für weitere Geräte wird in Phase 4 entschieden** (Optionen 3–5), spätestens mit Web Push. Ein dritter Container ist weiterhin ausgeschlossen, solange ADR 0006 gilt.

## Konsequenzen

- Neue Abhängigkeiten im Image müssen arm64-Prebuilds haben oder ohne Compiler auskommen; der CI-Job `docker-arm64` fällt sonst auf. Er läuft unter QEMU und ist langsamer als der x86-Build (Layer-Cache über GitHub Actions); bei Bedarf native `ubuntu-24.04-arm`-Runner.
- Der SSH-Server des Hosts muss lokales Forwarding erlauben, möglichst eingeschränkt (`Match User …`, `AllowTcpForwarding local`, `PermitOpen 127.0.0.1:<port>`).
- Öffentliche Erreichbarkeit setzt TLS und Login-Rate-Limiting voraus (Phase 1, offen). Hinter rootless Docker oder Proxies muss das Rate-Limiting die echte Client-IP kennen.
- Phase 4 braucht ein eigenes ADR (oder eine Ergänzung hier) für HTTPS auf Smartphones.
