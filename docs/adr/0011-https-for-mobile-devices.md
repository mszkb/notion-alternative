# 0011 – HTTPS für Smartphones und weitere Geräte

- **Status:** Proposed
- **Datum:** 2026-10-03

## Kontext

Service Worker, Installation als PWA und Web Push brauchen einen sicheren Kontext. Das Referenz-Deployment ([ADR 0010](0010-reference-deployment-and-https.md)) bindet die App an `127.0.0.1` und erreicht sie per SSH-Tunnel – für Smartphones praktisch unbrauchbar. Seit Phase 4 sind Service Worker und Web Push umgesetzt, Login-Rate-Limiting ist vorhanden. iOS akzeptiert für installierte PWAs und Web Push nur öffentlich vertrauenswürdige Zertifikate zuverlässig; selbst verteilte CAs (mkcert, Caddy intern) sind dort fehleranfällig. Ein dritter Container bleibt durch [ADR 0006](0006-tech-stack.md) ausgeschlossen.

## Optionen

Aus ADR 0010, ergänzt um die Erfahrungen aus Phase 4:

1. **Tailscale HTTPS (`tailscale serve`) auf dem Host.** `tailscale serve --bg --https=443 http://127.0.0.1:8080` stellt die App unter `https://<host>.<tailnet>.ts.net` mit Let's-Encrypt-Zertifikat bereit, nur im eigenen Tailnet. **+** Vertrauenswürdiges Zertifikat (iOS-PWA und Web Push funktionieren), nichts im Internet erreichbar, keine Änderung an Compose oder nginx, `BIND_ADDRESS=127.0.0.1` bleibt. **−** Tailscale-App auf jedem Gerät, Koordinationsdienst eines Drittanbieters, Hostname in Certificate-Transparency-Logs.
2. **TLS im `frontend`-nginx mit Zertifikat von außen** (`tailscale cert`, ACME per DNS-01, eigenes Zertifikat). **+** Zwei Container, unabhängig von Tailscale möglich. **−** nginx-Konfiguration mit TLS-Block, Zertifikatsdateien als Volume, Erneuerung außerhalb der App; bei öffentlicher Erreichbarkeit volle Angriffsfläche.
3. **Vorhandener Reverse Proxy mit Let's Encrypt** (Traefik, Caddy, nginx auf dem Host, öffentlich). **+** Kein Client-Setup, echte Zertifikate. **−** Aus dem Internet erreichbar; braucht Domain und gepflegten Proxy. Login-Rate-Limiting ist jetzt vorhanden, Härtung folgt in Phase 7.
4. **Eigene CA** (mkcert, Caddy intern). **−** CA auf jedem Gerät installieren; iOS-PWA/Web Push unzuverlässig. Nicht empfohlen.

## Empfehlung (zur Entscheidung)

**Option 1 als empfohlener Weg für Smartphones**, Option 3 als dokumentierte Alternative für Betreiber mit eigener Domain und eigenem Reverse Proxy. Die App braucht dafür keine Code-Änderung: Sie läuft hinter jedem TLS-terminierenden Proxy, der auf `127.0.0.1:8080` zeigt. Mit HTTPS `COOKIE_SECURE=true` setzen (der SSH-Tunnel über `http://localhost` funktioniert damit weiter, Browser behandeln `localhost` als sicher).

Offen bis zur Annahme:

- Test auf echtem iPhone und Android-Gerät: Installation, Offline-Neustart, Web Push (Prüfliste T-PWA-01 in [`docs/user/installation.md`](../user/installation.md)).
- Entscheidung, ob ein Drittanbieter (Tailscale) für den empfohlenen Weg akzeptabel ist.

## Konsequenzen

- Betreiber-Doku in `docs/operations/deployment.md` beschreibt beide Wege; Compose und nginx bleiben unverändert.
- Der Server muss ausgehend die Push-Dienste erreichen (`fcm.googleapis.com`, `*.push.apple.com` usw., siehe `PUSH_ALLOWED_HOSTS`).
- Wird Option 2 gewünscht (TLS ohne Tailscale und ohne Host-Proxy), folgt eine optionale TLS-Konfiguration für den `frontend`-Container als eigene Aufgabe.
