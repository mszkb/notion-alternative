# Notion Alt – native App (Android, später iOS)

Kotlin Multiplatform + Compose Multiplatform ([ADR 0020](../../docs/adr/0020-native-apps-kmp.md), Epic #147). Die App ist ein weiterer Client des bestehenden Servers: lokale SQLite-Datenbank pro Benutzer, Offline-Queue, Sync über `/api/sync/*` wie die Web-App. Am Server ändert sich nichts.

## Heute Abend ausprobieren (Debug-APK)

1. Auf dem Telefon die APK laden: <https://github.com/mszkb/notion-alternative/releases/download/android-dev/notion-alt-dev.apk> (Pre-Release [`android-dev`](https://github.com/mszkb/notion-alternative/releases/tag/android-dev), wird bei jedem grünen Build ersetzt).
2. Beim Öffnen der Datei fragt Android, ob der Browser bzw. die Dateien-App **unbekannte Apps installieren** darf: in den Einstellungen für diese App erlauben, zurück, „Installieren“. Play Protect warnt eventuell („Unbekannter Entwickler“) – „Trotzdem installieren“.
3. App „Notion Alt (Dev)“ öffnen und die **Server-Adresse** eintragen, so wie sie im Browser funktioniert:
   - Tailscale mit HTTPS (ADR 0011): `https://<rechner>.<tailnet>.ts.net`
   - Webhosting/Reverse Proxy: `https://notizen.example.org` (auch mit Unterpfad, z. B. `https://example.org/notizen`)
   - Heimnetz ohne Zertifikat: `http://192.168.x.y:8080` – **nur in diesem Debug-Build** erlaubt. Der Docker-Stack muss dafür im LAN lauschen (`BIND_ADDRESS=0.0.0.0`, Standard ist nur `127.0.0.1`).
   - `https://` wird ergänzt, wenn nichts angegeben ist; ein `/api` am Ende wird entfernt.
4. Mit E-Mail und Passwort des bestehenden Kontos anmelden. Die App registriert sich als Gerät („Android-App auf …“, sichtbar in den Einstellungen der Web-App) und lädt Seitenbaum und Metadaten. Seiteninhalte kommen beim Öffnen einer Seite (ADR 0017).
5. Updates: neue APK einfach über die alte installieren (fester Debug-Schlüssel, Daten bleiben erhalten).

Was geht:

- Workspace wählen (Titel oben antippen), Seitenbaum auf- und zuklappen, Favoriten oben.
- Seite öffnen: Titel, Icon und Blöcke (Absatz, Überschriften, Listen, To-do, Toggle, Zitat, Code, Trenner, Hinweis); fett, kursiv, Code und Links; Seitenlinks öffnen die verlinkte Seite.
- Bilder: Bild-Blöcke werden vom Server geladen und für offline gespeichert (Hochladen geht noch nicht).
- Bearbeiten: neue Seite (+), Unterseite (+ in der Zeile oder Menü), Titel ändern, Block antippen zum Bearbeiten, Enter teilt den Block (Enter in einem leeren Listenpunkt beendet die Liste, Enter am Toggle legt ein Kind an; Rücktaste am Blockanfang verbindet mit dem Block darüber, sofern die Tastatur sie meldet), Blocktyp, Einrückung und Verschieben über die Leiste unter dem Block, Markdown-Kürzel am Zeilenanfang (`# `, `## `, `- `, `1. `, `[] `, `> `, ` ``` `, `---`), Block löschen, To-do abhaken, Rückgängig (Pfeil oben, für die Änderungen seit dem Öffnen der Seite), Seite löschen (Papierkorb, Wiederherstellen über Menü ⋮ → Papierkorb), Seite verschieben (Menü der Seite), Tags unter dem Titel (antippen entfernt), Icon ändern (Menü der Seite), Favorit setzen. Am Seitenende: „Verlinkt von“.
- Suche (Lupe): Titel und Text der Seiten, deren Inhalt auf dem Gerät ist; funktioniert offline.
- „Alles offline verfügbar machen“ (Menü ⋮) lädt alle Seiteninhalte, danach ist alles im Flugmodus lesbar.
- Offline: Alles Geladene ist ohne Netz lesbar und bearbeitbar (auch im Flugmodus nach Neustart). Änderungen landen in der Queue und werden später gesendet.
- Sync: beim Start, beim Wechsel in den Vordergrund, 2 s nach lokalen Änderungen, alle 5 Minuten bei offener App, per Pull-to-refresh bzw. Sync-Knopf und im Hintergrund etwa alle 15 Minuten (WorkManager). Statuszeile: offline, synchronisiert, n ausstehend, Fehler.
- Konflikte: Hinweis auf der Seite und Liste (Warnsymbol oben). Beide Versionen bleiben erhalten; „Server-Version behalten“ oder „… übernehmen“ für geänderte Blöcke und Seitentitel, andere Fälle (z. B. gelöschte Seiten) in der Web-App. Vom Server abgelehnte Änderungen bleiben in der Queue und sind über die Statuszeile einsehbar.
- Abmelden warnt bei ausstehenden Änderungen; die lokalen Daten bleiben auf dem Gerät.

Bekannte Einschränkungen (Stand heute):

- Keine Push-Benachrichtigungen (kein FCM), nur Sync-Trigger wie oben.
- Kein Slash-Menü (stattdessen Leiste unter dem Block), keine Datei-Anhänge (nur Bilder anzeigen, kein Hochladen), Suche ohne Volltextindex, kein Export.
- Das Session-Cookie liegt in der App-Datenbank (Keystore folgt mit #171), keine Token-Auth (#152).
- Datum der letzten Synchronisierung in UTC.
- Große Workspaces: Listen werden auf dem Hauptthread gelesen; bei sehr vielen Seiten kann die App träge werden.

## Wenn etwas nicht klappt

| Meldung / Verhalten | Ursache und Abhilfe |
| --- | --- |
| „Server … ist nicht erreichbar“ | Adresse im Browser des Telefons öffnen. Der Docker-Stack lauscht standardmäßig nur auf `127.0.0.1` (ADR 0010): fürs Heimnetz `BIND_ADDRESS=0.0.0.0` in `.env` setzen (nur im vertrauenswürdigen Netz) oder `tailscale serve` nutzen. Heimnetz: richtige IP und Port (`:8080`), Telefon im selben WLAN. Tailscale: Tailscale-App auf dem Telefon verbunden. |
| „Unverschlüsseltes HTTP ist … nicht erlaubt“ | Nur der Debug-Build erlaubt `http://`; die APK aus `android-dev` ist ein Debug-Build. Sonst `https://` verwenden. |
| „Das Zertifikat … wird nicht akzeptiert“ | Selbst signierte Zertifikate werden nicht akzeptiert. Tailscale-HTTPS (`tailscale serve`) oder ein Reverse Proxy mit Let’s Encrypt nutzen (ADR 0011). |
| „Unter … antwortet kein Notion-Alt-Server“ | Die Adresse zeigt auf etwas anderes (z. B. Router-Seite, falscher Unterpfad). Die Adresse eintragen, unter der die Web-App läuft, ohne `/api`. |
| Statuszeile „Sitzung abgelaufen“ | Antippen → neu anmelden. Ausstehende Änderungen bleiben erhalten und werden danach gesendet. |
| Statuszeile „… vom Server abgelehnt“ | Antippen zeigt die Gründe. Die Änderungen bleiben auf dem Gerät; bitte melden (Screenshot). |
| Seite zeigt „noch nicht auf diesem Gerät“ | Inhalt wird beim Öffnen geladen; ohne Verbindung geht das nicht. Vorher „Alles offline verfügbar machen“ (Menü ⋮). |
| Hängt / unklarer Zustand | Menü ⋮ → „Info“ zeigt Server, Geräte-ID, ausstehende Änderungen und den letzten Fehler. Menü ⋮ → „Neu synchronisieren“ lädt alles neu, ohne lokale Änderungen zu verwerfen. |

Das Gerät erscheint in der Web-App unter den Geräten als „Android-App auf …“. Deinstallieren löscht die lokalen Daten der App (auch nicht synchronisierte Änderungen) – vorher in der Statuszeile prüfen, dass nichts aussteht.

## Aufbau

| Modul | Inhalt |
| --- | --- |
| `core/` | KMP-Logik in `commonMain`: Modelle (`model/`), API-Client mit Session-Cookie (`api/`), `LocalStore` auf SQLDelight (Entität und Operation in einer Transaktion), `SyncEngine` (Push in Batches, Delta-Pull per Cursor, seitenweiser Snapshot, Inhalte bei Bedarf), Sortierschlüssel (Port von `fractional-indexing`), Markdown-Inline. Targets `jvm`, `iosArm64`, `iosSimulatorArm64`. |
| `shared/` | Compose-Multiplatform-UI in `commonMain`, Plattformdienste hinter `Platform` (`androidMain`: SQLite-Treiber, OkHttp, WorkManager; `PushRegistrar` ist ein No-op). |
| `androidApp/` | Activity, Manifest, `network_security_config` (HTTP nur im Debug-Build). |

## Bauen

Voraussetzungen: JDK 17 oder neuer, Android SDK (Plattform 35) für die App; für reine Logik genügt ein JDK.

```sh
cd apps/mobile
./gradlew :androidApp:assembleDebug        # APK: androidApp/build/outputs/apk/debug/
./gradlew :core:jvmTest :androidApp:testDebugUnitTest
./gradlew -Pmobile.jvmOnly=true :core:jvmTest   # ohne Android SDK und Google Maven
```

Tests gegen einen echten Server (zwei „Geräte“: Login, Snapshot, Laden bei Bedarf, Delta-Pull, Konflikt, Tombstone; dazu der UI-Smoketest mit Robolectric):

```sh
cd apps/server && composer install
DATABASE_PATH=/tmp/notion-alt/app.sqlite php -S 127.0.0.1:8099 -t public public/index.php &
curl -X POST http://127.0.0.1:8099/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"test@example.org","password":"geheim12345"}'
cd ../mobile && NOTION_ALT_SERVER=http://127.0.0.1:8099 ./gradlew :core:jvmTest :androidApp:testDebugUnitTest
```

CI: `.github/workflows/android.yml` startet denselben Server, führt alle Tests aus, baut die Debug-APK, lädt sie als Artefakt hoch und ersetzt sie in der Pre-Release `android-dev`.
