# 0011 – HTTPS für Smartphones und weitere Geräte

- **Status:** Accepted
- **Datum:** 2026-10-03, angenommen 2026-10-07

## Kontext

Service Worker, Installation als PWA und Web Push brauchen einen sicheren Kontext. Das Referenz-Deployment ([ADR 0010](0010-reference-deployment-and-https.md)) bindet die App an `127.0.0.1` und erreicht sie per SSH-Tunnel – für Smartphones praktisch unbrauchbar. Seit Phase 4 sind Service Worker und Web Push umgesetzt, Login-Rate-Limiting ist vorhanden. iOS akzeptiert für installierte PWAs und Web Push nur öffentlich vertrauenswürdige Zertifikate zuverlässig; selbst verteilte CAs (mkcert, Caddy intern) sind dort fehleranfällig. Ein dritter Container bleibt durch [ADR 0006](0006-tech-stack.md) ausgeschlossen.

## Optionen

Aus ADR 0010, ergänzt um die Erfahrungen aus Phase 4:

1. **Tailscale HTTPS (`tailscale serve`) auf dem Host.** `tailscale serve --bg --https=443 http://127.0.0.1:8080` stellt die App unter `https://<host>.<tailnet>.ts.net` mit Let's-Encrypt-Zertifikat bereit, nur im eigenen Tailnet. **+** Vertrauenswürdiges Zertifikat (iOS-PWA und Web Push funktionieren), nichts im Internet erreichbar, keine Änderung an Compose oder nginx, `BIND_ADDRESS=127.0.0.1` bleibt. **−** Tailscale-App auf jedem Gerät, Koordinationsdienst eines Drittanbieters, Hostname in Certificate-Transparency-Logs.
2. **TLS im `frontend`-nginx mit Zertifikat von außen** (`tailscale cert`, ACME per DNS-01, eigenes Zertifikat). **+** Zwei Container, unabhängig von Tailscale möglich. **−** nginx-Konfiguration mit TLS-Block, Zertifikatsdateien als Volume, Erneuerung außerhalb der App; bei öffentlicher Erreichbarkeit volle Angriffsfläche.
3. **Vorhandener Reverse Proxy mit Let's Encrypt** (Traefik, Caddy, nginx auf dem Host, öffentlich). **+** Kein Client-Setup, echte Zertifikate. **−** Aus dem Internet erreichbar; braucht Domain und gepflegten Proxy. Login-Rate-Limiting ist jetzt vorhanden, Härtung folgt in Phase 7.
4. **Eigene CA** (mkcert, Caddy intern). **−** CA auf jedem Gerät installieren; iOS-PWA/Web Push unzuverlässig. Nicht empfohlen.

## Entscheidung

Angenommen am 2026-10-07 ([#61](https://github.com/mszkb/notion-alternative/issues/61)). Es gibt zwei empfohlene Wege, je nach Betreiber:

- **Home-Lab und Raspberry Pi: Tailscale (Option 1).** Wer die App zu Hause oder auf einem eigenen kleinen Server betreibt, nutzt `tailscale serve`. Nichts ist aus dem Internet erreichbar, und das Zertifikat ist vertrauenswürdig (iOS-PWA und Web Push).
- **Alle anderen: Webhosting mit fertig eingerichtetem Webserver (Option 3).** Wer einen Webhoster, einen VPS mit Hoster-Panel oder einen vorhandenen Reverse Proxy hat, lässt HTTPS dort terminieren (Let's Encrypt über Hoster oder Proxy). Für die primäre Zielgruppe (Umsteiger von Notion, [`vision.md`](../product/vision.md)) ist das der naheliegende Weg; Shared Hosting ohne Docker folgt mit dem PHP-Backend ([#116](https://github.com/mszkb/notion-alternative/issues/116)).

Die App braucht dafür keine Code-Änderung: Sie läuft hinter jedem TLS-terminierenden Proxy, der auf `127.0.0.1:8080` zeigt. Mit HTTPS `COOKIE_SECURE=true` setzen (der SSH-Tunnel über `http://localhost` funktioniert damit weiter, Browser behandeln `localhost` als sicher).

Nicht gewählt: TLS im `frontend`-nginx (Option 2), weil Zertifikatserneuerung dann Aufgabe des Betreibers bleibt und beide gewählten Wege sie abnehmen; eigene CA (Option 4), weil iOS sie für PWA und Web Push nicht zuverlässig akzeptiert.

Die Prüfliste auf echten Geräten (T-PWA-01 in [`docs/user/installation.md`](../user/installation.md)) bleibt als manueller Test bestehen; sie ändert die Entscheidung nicht, weil beide Wege öffentlich vertrauenswürdige Zertifikate liefern.

## Konsequenzen

- Betreiber-Doku in `docs/operations/deployment.md` beschreibt beide Wege; Compose und nginx bleiben unverändert.
- Der Server muss ausgehend die Push-Dienste erreichen (`fcm.googleapis.com`, `*.push.apple.com` usw., siehe `PUSH_ALLOWED_HOSTS`).
- Wird Option 2 gewünscht (TLS ohne Tailscale und ohne Host-Proxy), folgt eine optionale TLS-Konfiguration für den `frontend`-Container als eigene Aufgabe.
