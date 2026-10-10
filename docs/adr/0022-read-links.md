# 0022 – Lese-Links für Externe

- **Status:** Accepted
- **Datum:** 2026-10-10, angenommen 2026-10-10

## Kontext

Workspaces lassen sich mit Konten derselben Installation teilen ([ADR 0014](0014-sharing-and-permissions.md)). Wer kein Konto hat (Kundin, Kollege aus einer anderen Firma, Familie), sieht nichts. ADR 0014 sieht dafür öffentliche Lese-Links mit eigenem ADR vor ([#178](https://github.com/mszkb/notion-alternative/issues/178)).

Anforderungen:

- Nur lesend, widerrufbar, mit Ablaufdatum.
- Keine Workspace-IDs und keine E-Mail-Adressen in der Ausgabe; fremde Seiten nie sichtbar.
- `noindex`, Rate-Limits, dieselbe CSP wie die App.
- Prinzipien: Offline-first gilt für Mitglieder unverändert. Externe sind online-only, sie bekommen weder Sync noch Export.

## Optionen

### Umfang

1. **Einzelne Seite:** Der Link zeigt genau eine Seite.
   - **+** Leicht zu prüfen: eine Seite, ihre Blöcke, ihre Bilder. Kein Filter über den Seitenbaum.
   - **+** Verschieben im Seitenbaum ändert nichts an der Sichtbarkeit.
   - **−** Unterseiten brauchen je einen eigenen Link.
2. **Teilbaum:** Die Seite und alle Unterseiten.
   - **+** Bequemer für Handbücher und Wikis.
   - **−** Die Sichtbarkeit ändert sich, wenn jemand eine Seite in den Teilbaum oder heraus verschiebt (genau das Problem, das ADR 0014 mit Option 2 vermeidet).
3. **Ganzer Workspace:** wie 2, nur noch breiter. Ein vergessener Link legt alles offen.

### Auslieferung

1. **SPA im Gastmodus:** eigene Route `/share/<token>` in der App; sie lädt die Seite als JSON über einen öffentlichen Endpunkt und rendert sie schreibgeschützt.
   - **+** Derselbe Inline-Renderer wie im Editor (keine zweite Markdown-Implementierung in PHP, kein Unterschied in der Darstellung).
   - **+** Dieselbe CSP und dieselben Design-Tokens; kein HTML aus dem Server.
   - **−** Ohne JavaScript nichts zu sehen; der Gast lädt das App-Bundle.
2. **Serverseitig gerenderte HTML-Seite:** PHP baut das HTML.
   - **+** Kein JavaScript nötig, kleinste Antwort.
   - **−** Zweiter Renderer für Markdown-Inline und alle Blocktypen (ADR 0019), der mit dem Editor auseinanderlaufen kann. Escaping-Fehler wären ein XSS im Origin der App.

### Token

1. **Zufälliger Token, nur als Hash gespeichert:** 32 Zufallsbytes (base64url, 43 Zeichen). Gespeichert wird `sha256(token)`, wie bei Sitzungen.
   - **+** Ein Datenbank-Leck (Backup) verrät keine gültigen Links.
   - **−** Der Link lässt sich nur direkt nach dem Anlegen kopieren. Wer ihn verliert, legt einen neuen an und widerruft den alten.
2. **Token im Klartext gespeichert:** Link jederzeit wieder kopierbar, aber jedes Backup enthält alle gültigen Links.

## Entscheidung

**Einzelne Seite, SPA im Gastmodus, Token nur als Hash** (vom Maintainer angenommen, 2026-10-10). Teilbäume können später dazukommen, wenn sich zeigt, dass sie gebraucht werden.

**Datenmodell:** neue Tabelle `share_links(id, token_hash, workspace_id, document_id, created_by, created_at, expires_at)`. `token_hash` ist eindeutig. `workspace_id` und `created_by` haben `on delete cascade`: Wird der Workspace oder das Konto des Erstellers gelöscht, verschwinden seine Links. Widerrufen löscht die Zeile.

**Wer darf was:**

- Anlegen, auflisten, widerrufen: ab `editor` im Workspace. Wer die Seite ändern oder löschen darf, darf sie auch zeigen. Leser und Kommentierende sehen keine Links.
- Ein Editor darf auch Links anderer Mitglieder widerrufen (wie er auch die Seite löschen dürfte).
- Ein Link gilt nur, solange sein Ersteller noch mindestens `editor` im Workspace ist. Wird er entfernt oder herabgestuft, sind seine Links sofort ungültig, ohne dass jemand daran denken muss.

**Ablauf:** `expiresAt` ist optional (ISO-Zeitpunkt in der Zukunft) oder `null` = unbefristet. Die Oberfläche schlägt 30 Tage vor. Abgelaufene Links liefern `404` und bleiben in der Liste sichtbar, bis jemand sie entfernt.

**API:**

| Methode | Pfad | Recht | Antwort |
| --- | --- | --- | --- |
| `GET` | `/api/workspaces/:id/share-links?documentId=` | `editor` | `{ links: [...] }` ohne Token |
| `POST` | `/api/workspaces/:id/share-links` | `editor` | `201 { link, token }`; der Token kommt nur hier |
| `DELETE` | `/api/workspaces/:id/share-links/:linkId` | `editor` | `204` |
| `GET` | `/api/public/shares/:token` | keins | `{ page: { title, icon, cover, updatedAt }, blocks: [{ type, content, attrs }] }` |
| `GET` | `/api/public/shares/:token/attachments/:attachmentId` | keins | Bild der freigegebenen Seite |

**Was der Gast sieht:**

- Titel, Icon, Titelbild und die Blöcke der Seite in ihrer Reihenfolge. Keine Block-, Workspace- oder Konto-IDs, keine E-Mail-Adressen, keine Tags, kein Verlauf, keine Kommentare.
- **Bilder ja:** nur Rasterbilder (dieselben Typen, die die App inline zeigt), nur wenn ein aktiver Bildblock oder das Titelbild der freigegebenen Seite darauf verweist.
- **Dateien nein:** Dateiblöcke zeigen nur den Namen. Herunterladen bleibt Mitgliedern vorbehalten.
- **Seitenlinks** zu anderen Seiten erscheinen als normaler Text ohne Ziel. Ihr Linktext ist Teil der freigegebenen Seite, die verlinkten Seiten selbst bleiben unsichtbar.
- Ungültiger, abgelaufener oder widerrufener Token, gelöschte Seite (auch im Papierkorb) und Ersteller ohne Recht ergeben dasselbe `404 not_found`. Damit verrät die Antwort nicht, warum ein Link nicht (mehr) gilt.

**Sicherheit:**

- Öffentliche Antworten tragen `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` und `Referrer-Policy: no-referrer`. Die Gast-Ansicht setzt zusätzlich `<meta name="robots" content="noindex">`.
- Rate-Limit: Fehlgeschlagene Abrufe zählen pro Client-Adresse, mit Grenze und Fenster der Login-Fehlversuche (`LOGIN_MAX_FAILURES_PER_IP`, `AttemptLimiter`, Tabelle `auth_attempts`). Bei 256 Bit Zufall ist Raten aussichtslos, das Limit hält nur Lasten von Scannern fern.
- Das Request-Log ersetzt den Token durch `:token`: Wer das Log lesen kann, soll die Seiten nicht öffnen können.
- Anhänge kommen mit denselben Headern wie für Mitglieder (`nosniff`, `sandbox`-CSP).
- Die Gast-Ansicht öffnet keine lokale Datenbank, registriert keinen Service Worker und sendet keine Sitzungsanfrage.

**Prinzipien:** Für Mitglieder ändert sich nichts. Lese-Links sind online-only und kein Ersatz für Export; Export bleibt Mitgliedern vorbehalten.

## Konsequenzen

- Neue Migration und neue Endpunkte; die Autorisierungsmatrix in `packages/contract-tests/test/sharing.test.ts` bekommt die Link-Verwaltung.
- Contract-Tests für gültige, abgelaufene und widerrufene Links, Ersteller ohne Recht und fremde Seiten bzw. Anhänge (T-SHARE-06 bis T-SHARE-08).
- Die Oberfläche bekommt auf jeder Seite „Teilen“ mit Lese-Links (nur online, ab `editor`) und die öffentliche Route `/share/<token>`.
- Den Link kann man nur direkt nach dem Anlegen kopieren. Das erklärt die Nutzerdoku.
- Offen für später: Teilbäume, Passwortschutz, Zugriffszähler.
