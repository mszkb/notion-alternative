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
  "workspace": "ws_…"
}
```

## Umsetzung (Phase 4)

- **Ohne Bibliothek:** Verschlüsselung (RFC 8291, `aes128gcm`) und VAPID (RFC 8292, ES256) mit ext-openssl in `apps/server-php/src/Push/` (`WebPushCrypto`, `Vapid`), geprüft gegen den Testvektor aus RFC 8291 Anhang A. Keine neue Abhängigkeit, arm64-unkritisch.
- **Schlüssel:** VAPID-Keypair und Installations-ID entstehen beim ersten Bedarf in der Tabelle `settings` und sind damit Teil des Datenbank-Backups. Gehen sie verloren, müssen alle Geräte Benachrichtigungen neu aktivieren.
- **Subscriptions** (`push_subscriptions`) gehören zu einem registrierten Gerät; Entfernen des Geräts oder des Kontos löscht sie. Endpunkte nur über `https` und nur zu erlaubten Push-Diensten (`PUSH_ALLOWED_HOSTS`, Standard: Google, Mozilla, Apple, Microsoft) – die URL stammt vom Client, ohne Allowlist könnte der Server beliebige Adressen ansprechen (SSRF).
- **Versand:** Nach jedem Push mit angewendeten Operationen (auch `merged`/`conflict`) bekommen die **anderen** Geräte des Workspace-Inhabers einen Hinweis; Änderungen innerhalb von 2 s werden zu einer Nachricht pro Gerät gebündelt (`Topic` pro Workspace, `TTL` 24 h). `404`/`410` des Push-Dienstes oder fünf Fehlschläge in Folge entfernen die Subscription.
- **Payload** genau `{ "type": "sync_available", "installation": "…", "workspace": "…" }`; ein Test entschlüsselt die versendete Nachricht und prüft, dass nichts anderes enthalten ist. Badge-Zahlen werden nicht gesendet; der Service Worker setzt nur einen Punkt (`setAppBadge()`), die App entfernt ihn nach dem nächsten Sync.
- **Client:** Kontoseite → „Benachrichtigungen aktivieren“ (nur per Klick). Der Service Worker leitet den Hinweis an offene Fenster weiter, die daraufhin synchronisieren; ist keine sichtbar, zeigt er eine allgemeine Benachrichtigung ohne Inhalt („Neue Änderungen“). Auf iOS nur in der installierten App.

## Später / Paid

- Optionales **Hosted Push Relay** als kostenpflichtige Komfortfunktion (Phase 9), z. B. für Installationen, die keine eigene Push-Infrastruktur betreiben wollen.

Entscheidung: [ADR 0005](../adr/0005-push.md)
