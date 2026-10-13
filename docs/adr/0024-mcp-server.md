# 0024 – MCP-Server für KI-Clients

- **Status:** Proposed
- **Datum:** 2026-10-13

## Kontext

KI-Clients (Claude Desktop/Code, claude.ai, Cursor, VS Code, lokale Modelle über Open-WebUI o. Ä.) sprechen das [Model Context Protocol](https://modelcontextprotocol.io) (MCP). Ein MCP-Server der Installation würde es erlauben, Seiten zu durchsuchen, zu lesen und zu ergänzen („fasse meine Meeting-Notizen der Woche zusammen“, „lege eine Seite mit diesen To-dos an“), ohne Export und Copy-and-paste.

Abgrenzung: Das ist **kein** eingebauter KI-Assistent (laut `docs/product/vision.md` nicht im MVP). Die App ruft kein Modell auf und schickt keine Inhalte an Dritte. Der MCP-Server ist eine weitere Schnittstelle wie die REST-API; welches Modell sie nutzt, entscheidet der Nutzer in seinem Client.

Anforderungen:

- **Self-hosted tauglich:** muss auf allen drei Wegen laufen: Webhosting (Release-ZIP, Apache/LiteSpeed, PHP-FPM oder `mod_php`, kein dauerhafter Prozess), Docker (nginx + PHP-FPM, nur `127.0.0.1`, ADR 0010) und Home-Lab hinter `tailscale serve` (ADR 0011). Kein dritter Container.
- **Prinzipien:** Keine stillen Überschreibungen (Prinzip 6): Schreibzugriffe laufen durch denselben Pfad wie der Sync und erzeugen Konflikte statt zu überschreiben. Jede Änderung hat eine Operation-ID, Löschungen erzeugen Tombstones, alle Geräte bekommen sie per Delta-Pull.
- **Rechte:** dieselben Rollen wie ADR 0014, nur serverseitig geprüft; Lese-Links (ADR 0022) bleiben davon getrennt.
- **Keine neue Laufzeit-Abhängigkeit**, solange es ohne geht (vgl. Web Push ohne Bibliothek, ADR 0005).

### Was im Code schon da ist

| Baustein | Stand | Nutzen für MCP |
| --- | --- | --- |
| Slim-Routen unter `/api` mit `RequireAuth` | vorhanden | `/api/mcp` ist eine Route wie jede andere |
| `Workspaces::findForUser($db, $ws, $user, $minimum)` | vorhanden | Rechteprüfung pro Tool-Aufruf |
| `SearchIndex::searchWorkspace` (FTS5) | vorhanden | Tool `search` fast ohne neuen Code |
| `GET /api/sync/documents/:id`, Snapshot | vorhanden | Seitenbaum und Seiteninhalt lesen |
| `Apply::batch` (Savepoint je Operation, Merge, Konflikte) | vorhanden | Schreib-Tools erzeugen Operationen, keine Sonderwege |
| Geräte (`devices`), Operationen brauchen `deviceId` | vorhanden | ein MCP-Zugang = ein Gerät; Verlauf zeigt, was die KI geändert hat |
| `InlineText::toPlainText` (PHP-Port) | vorhanden | Klartext für Suchtreffer |
| `blocksToMarkdown` (TS, ~100 Zeilen) | nur TypeScript | **muss nach PHP portiert werden** (Seite als Markdown lesen) |
| Markdown → Blöcke (Notion-Import, TS) | nur TypeScript | für Markdown-Eingabe; zunächst nicht nötig (siehe unten) |
| Token-Authentifizierung per Header | fehlt | Sitzungen laufen nur per Cookie; braucht Zugangstoken |

## Optionen

### Wo läuft der Server?

1. **Im PHP-Server als Endpunkt `/api/mcp` (Streamable HTTP, zustandslos):**
   - MCP über HTTP ist JSON-RPC per `POST` an einen Endpunkt. Der Server darf mit `application/json` antworten statt mit einem SSE-Stream und muss keine Sitzung halten (`Mcp-Session-Id` ist optional). Ein `GET` ohne Stream beantwortet er mit `405`. Das passt genau zum Anfrage/Antwort-Modell von PHP auf Webhosting.
   - **+** Läuft überall dort, wo die App läuft; nichts zusätzlich zu installieren oder zu betreiben. Kein dritter Container.
   - **+** Direkter Zugriff auf `Apply`, `SearchIndex`, `Workspaces`: dieselben Prüfungen, dieselbe Transaktion, keine zweite Implementierung der Regeln.
   - **+** Contract-Tests können den Endpunkt wie jeden anderen prüfen.
   - **−** Blöcke → Markdown muss nach PHP portiert werden (klein, mit Fixtures aus dem TS-Code absicherbar).
   - **−** Keine Server-Benachrichtigungen per SSE (z. B. `notifications/resources/updated`). Für Tools nicht nötig.
2. **Eigenes Paket `packages/mcp` (Node, stdio, `@modelcontextprotocol/sdk`), das die REST-API aufruft:**
   - **+** Offizielles SDK, Markdown-Code aus `@notion-alt/shared` direkt nutzbar.
   - **−** Läuft auf dem Rechner des Nutzers und braucht dort Node; für weniger technikaffine Umsteiger eine Hürde, auf dem Smartphone und in claude.ai gar nicht nutzbar.
   - **−** Muss ein Gerät registrieren, Operationen bauen, Cursor und Revisionen verwalten: ein zweiter Sync-Client neben der Web-App.
   - **−** Neue Abhängigkeit, eigener Release-Weg.
3. **Lokal über die Daten im Browser (Dexie):** Ein MCP-Client kommt an IndexedDB der PWA nicht heran. Nicht umsetzbar ohne Browser-Erweiterung oder Desktop-Hülle; verworfen.

### Bibliothek oder selbst?

1. **Protokoll selbst implementieren:** Für einen zustandslosen Server mit Tools reichen `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` plus JSON-RPC-Fehler. Geschätzt 300–400 Zeilen, vollständig testbar.
2. **PHP-SDK (`mcp/sdk`):** bringt Transporte, Sitzungsspeicher und Attribute mit, ist aber jung, zieht Symfony-Komponenten nach und passt nicht zu Slim/PSR-7 ohne Adapter. Wäre eine neue Abhängigkeit mit eigenem ADR.

### Authentifizierung

1. **Persönliche Zugangstoken (`Authorization: Bearer …`):** Der Nutzer legt in den Einstellungen einen Zugang an („Claude auf Laptop“), wählt Workspaces und „nur lesen“ / „lesen und schreiben“ und kopiert Token und URL in seinen Client. Gespeichert wird nur `sha256(token)`, wie bei Sitzungen und Lese-Links.
   - **+** Funktioniert mit Claude Code (`claude mcp add --transport http … --header "Authorization: Bearer …"`), Claude Desktop, Cursor, VS Code.
   - **−** claude.ai-Connectoren und manche andere Web-Clients erwarten OAuth.
2. **OAuth 2.1 nach MCP-Spezifikation** (Protected Resource Metadata, Autorisierungsserver mit PKCE, dynamische Client-Registrierung bzw. Client-ID-Metadaten):
   - **+** Anmeldung per Browser, kein Token kopieren; nötig für claude.ai.
   - **−** Ein eigener Autorisierungsserver (Login-Seite, Zustimmung, Codes, Refresh-Token, Widerruf) ist der größte Einzelposten des ganzen Vorhabens und sicherheitskritisch.

## Entscheidung (Vorschlag)

**Option 1 jeweils:** Endpunkt `POST /api/mcp` im PHP-Server, Streamable HTTP ohne SSE und ohne Sitzungen, Protokoll ohne Bibliothek, zunächst nur persönliche Zugangstoken. OAuth folgt als eigene Stufe mit eigenem ADR, wenn claude.ai-Anbindung gewünscht ist.

### Zugangstoken

- Neue Tabelle `access_tokens(id, user_id, device_id, name, token_hash, scope, workspace_ids, created_at, last_used_at, expires_at)`; `scope` ist `read` oder `write`, `workspace_ids` leer = alle eigenen. Löschen eines Kontos oder Geräts entfernt den Token (`on delete cascade`).
- Jedes Token bekommt beim Anlegen ein eigenes Gerät (`devices`). Damit stehen KI-Änderungen im Verlauf unter einem erkennbaren Namen, und Widerrufen über die Geräteverwaltung (#46) sperrt den Zugang.
- Token gelten **nur** für `/api/mcp`, nicht für die übrige API. Eine neue Middleware `RequireAccessToken` liefert denselben `AuthContext` wie `RequireAuth`.
- Effektive Rechte = Rolle im Workspace (ADR 0014) ∩ Scope des Tokens. Ein Token kann nie mehr als sein Konto.

### Tools (Stufe 1 lesend, Stufe 2 schreibend)

| Tool | Stufe | Mindestrolle | Inhalt |
| --- | --- | --- | --- |
| `list_workspaces` | 1 | `reader` | Workspaces mit Rolle |
| `list_pages` | 1 | `reader` | Seitenbaum (Titel, IDs, Eltern), optional ab einer Seite |
| `search` | 1 | `reader` | FTS5, Treffer mit Seiten-ID, Titel, Ausschnitt |
| `read_page` | 1 | `reader` | Seite als Markdown (Blöcke mit Block-IDs als Kommentar oder Liste), Tags, Revisionen |
| `create_page` | 2 | `editor` | neue Seite unter Eltern-Seite, Inhalt als Liste von Blöcken |
| `append_blocks` | 2 | `editor` | Blöcke am Ende oder nach einem Block einfügen |
| `update_block` | 2 | `editor` | Text/Typ eines Blocks ändern, mit `baseRevision` aus `read_page` |
| `set_page_title`, `tag_page` | 2 | `editor` | Titel, Tags |

- Schreib-Tools bauen Operationen (`opId` neu, `deviceId` des Tokens, `baseRevision` aus dem Lesen) und rufen `Apply::batch`. Ergebnis `conflict` geht als Tool-Fehler mit Hinweis „Seite neu lesen“ an das Modell zurück. Es gibt **kein** Überschreiben ohne Revision.
- Löschen bietet Stufe 2 nicht an. Falls später gewünscht: nur als Tombstone, mit `restore` im Verlauf, und mit `destructiveHint` in den Tool-Annotationen.
- Blockinhalt ist Markdown-Inline (ADR 0008); Blöcke werden als `{type, content, attrs}` übergeben. Eine Eingabe als freies Markdown (Port des Parsers nach PHP) kommt nur, wenn sich die Blockliste in der Praxis als hinderlich erweist.
- Ressourcen (`resources/list`) und Prompts werden zunächst nicht angeboten; die meisten Clients nutzen Tools.

### Sicherheit

- `Origin`-Header prüfen (Schutz gegen DNS-Rebinding laut Spezifikation), Rate-Limit pro Token wie beim Login (`AttemptLimiter`).
- Antworten begrenzen (Seitenlänge, Trefferzahl), damit ein Aufruf nicht die ganze Datenbank ausliefert.
- **Prompt-Injection:** Seiten in geteilten Workspaces stammen von anderen Mitgliedern. Die Nutzer-Doku weist darauf hin; „nur lesen“ ist der vorgeschlagene Standard beim Anlegen.
- Webhosting: Apache mit PHP-FPM/CGI reicht den `Authorization`-Header oft nicht weiter. Die mitgelieferte `.htaccess` braucht `CGIPassAuth On` bzw. `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1`; `api/check.php` prüft das.

## Konsequenzen

Einschätzung der Umsetzbarkeit: **gut**. Das Protokoll in der zustandslosen HTTP-Variante passt zum PHP-Modell, und die schwierigen Teile (Rechte, Merge, Konflikte, Tombstones, Suche) existieren schon. Neu sind Zugangstoken, die Protokollschicht und ein Markdown-Port.

Folgeaufgaben, grob geschätzt:

1. **Zugangstoken** (Migration, `RequireAccessToken`, Endpunkte zum Anlegen/Auflisten/Widerrufen, Einstellungsseite in der Web-App, Contract-Tests inkl. Matrix in `sharing.test.ts`) – mittel.
2. **Protokollschicht** `apps/server/src/Mcp/` (JSON-RPC, `initialize` mit Versionsaushandlung, `tools/list`, `tools/call`, Fehlercodes, `405` für `GET`), Unit- und Contract-Tests, ein Test mit dem offiziellen MCP Inspector – klein bis mittel.
3. **Lese-Tools** und PHP-Port von `blocksToMarkdown` (Fixtures aus der TS-Version, damit beide gleich bleiben) – klein bis mittel.
4. **Webhosting-Anpassungen** (`.htaccess`, `check.php`, nginx unverändert), Doku `docs/user/mcp.md` mit Einrichtung für Claude Code/Desktop, Cursor, VS Code – klein.
5. **Schreib-Tools** über `Apply::batch`, Tests für Merge und Konflikt (Fälle aus `docs/testing/test-matrix.md`) – mittel.
6. **Optional OAuth 2.1** für claude.ai und andere Web-Clients – groß, eigener ADR.

Stufe 1 (Punkte 1–4) ist für sich nützlich und ändert keine Daten. Grenzen:

- Der MCP-Server sieht nur, was auf dem Server liegt: Der lokale Bereich ohne Konto (ADR 0023) und noch nicht synchronisierte Offline-Änderungen sind nicht erreichbar. Ohne Server kein MCP; die App selbst bleibt davon unberührt offline nutzbar.
- Änderungen der KI erreichen andere Geräte erst beim nächsten Sync (Start, Fokus, periodisch, Push-Hinweis). Der MCP-Endpunkt löst nach dem Schreiben denselben Push-Hinweis aus wie `/api/sync/push`.
- `docs/product/vision.md` wird bei Annahme ergänzt: Unter „Nicht im MVP“ bleibt ein **eingebauter** Assistent ausgeschlossen, eine MCP-Schnittstelle nicht.
