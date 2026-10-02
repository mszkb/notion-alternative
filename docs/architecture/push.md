# Push-Strategie

Grundsatz: **Push ist nur ein Hinweis.** Eine fehlende Push-Zustellung darf niemals Datenverlust verursachen. Die App synchronisiert unabhängig davon bei Start, Fokuswechsel und periodisch.

## MVP

- Web Push für installierte iOS-/Android-PWA und Desktop-Browser.
- Der self-hosted Server erzeugt und speichert ein **VAPID-Keypair**.
- Die PWA registriert eine Web-Push-Subscription **erst nach einer direkten Nutzeraktion** (Voraussetzung u. a. auf iOS).
- Push-Payload enthält ausschließlich:
  - `sync_available`
  - Workspace-/Installationsreferenz
  - optional Badge-Daten
- **Keine Inhalte** im Payload. Nach dem Push lädt die App die tatsächlichen Änderungen vom eigenen Sync-Server.

Beispiel-Payload:

```json
{
  "type": "sync_available",
  "installation": "inst_…",
  "workspace": "ws_…",
  "badge": 3
}
```

## Später / Paid

- Optionales **Hosted Push Relay** als kostenpflichtige Komfortfunktion (Phase 9), z. B. für Installationen, die keine eigene Push-Infrastruktur betreiben wollen.

Entscheidung: [ADR 0005](../adr/0005-push.md)
