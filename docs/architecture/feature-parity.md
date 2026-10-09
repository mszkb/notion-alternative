# Feature-Verzeichnis Web-App ↔ native App

Ein Ort für alle Features beider Clients: was es wo gibt, was fehlt und in welchen Dateien es steckt. Die Web-App (Vue, `apps/web`) und die native App (Kotlin Multiplatform, `apps/mobile`, [ADR 0020](../adr/0020-native-apps-kmp.md)) teilen keinen Code, nur das HTTP-API und die Verträge (`packages/shared`, `packages/contract-tests`). Logik, die in beiden steckt, muss deshalb von Hand gleich gehalten werden.

**Pflege:** Wer ein Feature in einem Client ändert oder neu baut, trägt es hier ein und zieht den anderen Client nach – oder markiert die Lücke (❌/🟡) mit Issue. Besonders wichtig ist der Abschnitt [Doppelt implementierte Logik](#doppelt-implementierte-logik): Änderungen dort ohne Gegenstück führen zu unterschiedlichem Sync-Verhalten.

Legende: ✅ vorhanden · 🟡 teilweise (Hinweis in der Spalte) · ❌ fehlt · — nicht sinnvoll für diesen Client

Pfad-Kürzel:

- **Web** = `apps/web/src/`
- **core** = `apps/mobile/core/src/commonMain/kotlin/net/notionalt/core/` (Logik, ohne UI)
- **ui** = `apps/mobile/shared/src/commonMain/kotlin/net/notionalt/ui/` (Compose-UI)
- **android** = `apps/mobile/shared/src/androidMain/kotlin/net/notionalt/ui/` bzw. `apps/mobile/androidApp/`
- **sq** = `apps/mobile/core/src/commonMain/sqldelight/user/net/notionalt/core/db/`

## Doppelt implementierte Logik

Diese Teile gibt es in beiden Clients als eigene Implementierung. Ändert sich eine Seite, muss die andere im selben PR (oder mit verlinktem Issue) folgen.

| Logik | Web | Native App | Gemeinsame Referenz / Tests |
| --- | --- | --- | --- |
| Operationen schreiben (Entität + Operation in einer Transaktion, Payload-Formate) | Web `local/store.ts` | core `store/LocalStore.kt` | `packages/shared/src/operations.ts` (Payload-Schemas), Contract-Tests `packages/contract-tests/test/sync*.test.ts` |
| Push-Ergebnisse anwenden (`applied`/`duplicate`/`merged`/`conflict`/`rejected`) | Web `local/store.ts` (`acknowledge`), `sync/push.ts` | core `store/LocalStore.kt` (`acknowledge`), `sync/SyncEngine.kt` (`pushQueue`) | `operations.ts` (`syncPushResultSchema`) |
| Batch-Grenzen Push (500 Operationen, 900 000 Bytes) | Web `sync/push.ts` | core `sync/SyncEngine.kt` | `SYNC_PUSH_MAX_OPERATIONS` in `operations.ts` |
| Pull anwenden (eigene Änderungen nur bestätigen, Entitäten mit Queue nicht überschreiben, Tombstones) | Web `local/store.ts` (`applyRemoteChange`) | core `store/LocalStore.kt` (`applyRemoteChange`) | ADR 0002, ADR 0003 |
| Re-Sync per Snapshot (seitenweise, 410 → Snapshot, ungesehene Entitäten entfernen) | Web `sync/resync.ts`, `local/store.ts` (`applySnapshotPage`, `finishResync`) | core `sync/SyncEngine.kt` (`syncWorkspace`), `store/LocalStore.kt` | ADR 0002, #97 |
| Server aus älterem Backup (#75: `recreateLost`, `resendNewer`) | Web `local/store.ts` | core `store/LocalStore.kt` | #75 |
| Inhalte bei Bedarf (`unloadedDocuments`, Seite beim Öffnen laden, „Alles offline“) | Web `sync/offline.ts`, `sync/resync.ts`, `local/store.ts` | core `sync/SyncEngine.kt` (`ensureDocumentLoaded`, `loadAll`), `store/LocalStore.kt` | ADR 0017 |
| Konfliktobjekte anwenden und auflösen (`adoptRemote`, `resolveConflict`) | Web `local/store.ts` | core `store/LocalStore.kt` (nur geänderte Blöcke/Seiten, kein `restoreAsCopy`) | ADR 0003 |
| Geräte-Registrierung, `device_revoked` → neue Geräte-ID | Web `device.ts`, `local/store.ts` (`replaceDeviceId`) | core `sync/SyncEngine.kt` (`registerDevice`), `store/LocalStore.kt` | #46 |
| Sortierschlüssel (fractional indexing) | `packages/shared/src/sort-key.ts` (npm `fractional-indexing`) | core `SortKey.kt` | Testvektoren in `apps/mobile/core/src/commonTest/kotlin/net/notionalt/core/SortKeyTest.kt` (aus der JS-Bibliothek erzeugt) |
| Markdown-Inline lesen (fett, kursiv, Code, Links, Seitenlinks) | `packages/shared/src/inline.ts`, Web `editor/inline-dom.ts` | core `Inline.kt`, ui `InlineText.kt` | ADR 0008; Mobile: nur Anzeige, Rohtext-Bearbeitung |
| Toggle-Kinder über `attrs.indent`, Zustand eingeklappt pro Gerät | Web `editor/PageEditor.vue`, `composables/tree-state.ts` | ui `PageScreen.kt` (`visibleBlocks`), Präferenz in core `store/LocalStore.kt` | ADR 0019 |
| Undo (Blockzustände wiederherstellen, gelöschte Blöcke mit neuer ID) | Web `editor/history.ts`, `local/store.ts` (`applyBlockState`) | ui `PageScreen.kt` (Checkpoints), core `store/LocalStore.kt` (`applyBlockState`) | ADR 0008 |
| Lokales Schema / Migrationen | Web `local/db.ts` (Dexie-Versionen) | sq `Content.sq`, `1.sqm`–`3.sqm` | jeweils nie bestehende Versionen ändern |
| Design-Tokens (Farben hell/dunkel) | Web `styles.css` | ui `Theme.kt`, `PageCover.kt` (Cover-Verläufe) | `docs/product/ux-guide.md` |

## Konto und Verbindung

| Feature | Web | Native App | Dateien |
| --- | --- | --- | --- |
| Server-Adresse eingeben und prüfen | — (gleiche Origin) | ✅ inkl. Weiterleitungen | core `api/ServerUrl.kt`, `AppSession.kt` (`connect`); ui `OnboardingScreens.kt` |
| Anmelden | ✅ | ✅ (Session-Cookie selbst verwaltet) | Web `views/LoginView.vue`, `session.ts`; core `AppSession.kt`, `api/ApiClient.kt` |
| Konto erstellen | ✅ | ❌ (Hinweis auf Web-App) | Web `views/LoginView.vue` |
| Offline-Start mit zuletzt angemeldetem Benutzer | ✅ | ✅ | Web `session.ts`; core `AppSession.kt` (`initialState`) |
| Sitzung abgelaufen → neu anmelden, lokale Daten bleiben | ✅ | ✅ | Web `session.ts`; core `AppSession.kt` (`relogin`, `backToLocalData`); ui `SyncStatusBar.kt` |
| Abmelden (Warnung bei ausstehenden Änderungen) | ✅ inkl. „Gerät entfernen“, „lokale Daten löschen“ | 🟡 nur Abmelden, lokale Daten bleiben | Web `views/HomeView.vue`; ui `HomeScreen.kt`; core `AppSession.logout` |
| Passwort ändern | ✅ | ❌ | Web `views/AccountView.vue` |
| Geräte auflisten, umbenennen, entfernen | ✅ | ❌ | Web `views/AccountView.vue` |
| Token-Auth, Keystore/Keychain | — | ❌ (#152, #171) | — |

## Workspaces und Seitenbaum

| Feature | Web | Native App | Dateien |
| --- | --- | --- | --- |
| Workspaces auflisten/wechseln | ✅ | ✅ | Web `views/HomeView.vue`, `composables/workspace.ts`; ui `HomeScreen.kt` |
| Workspace anlegen | ✅ | ❌ | Web `views/HomeView.vue` |
| Seitenbaum, auf-/zuklappen (pro Gerät gemerkt) | ✅ | ✅ | Web `components/TreeNode.vue`, `composables/tree-state.ts`; ui `HomeScreen.kt` |
| Seite/Unterseite anlegen | ✅ | ✅ | Web `layouts/WorkspaceLayout.vue`; ui `HomeScreen.kt`, `PageScreen.kt`; core `LocalStore.createDocument` |
| Seite verschieben | ✅ (Drag & Drop) | 🟡 nur Dialog „Verschieben nach …“, ans Ende | Web `components/TreeNode.vue`; ui `PageScreen.kt`; core `LocalStore.moveDocument` |
| Seite löschen (Papierkorb), wiederherstellen | ✅ | ✅ | Web `views/TrashView.vue`; ui `TrashScreen.kt`; core `LocalStore.deleteDocument`/`restoreDocument` |
| Endgültig löschen | ❌ | ❌ | (Tombstones bleiben, Sync-Invariante) |
| Favoriten | ✅ | ✅ | ui `HomeScreen.kt`, `PageScreen.kt`; core `LocalStore.setFavorite` |
| Zuletzt bearbeitet | ✅ | ✅ | Web `views/WorkspaceHome.vue`, `composables/recent-pages.ts`; ui `HomeScreen.kt` |
| Unterseiten-Liste auf der Seite | ✅ | ❌ | Web `views/PageView.vue` |
| Verlinkt von (Backlinks) | ✅ | ✅ | Web `views/PageView.vue`; core `LocalStore.backlinks`; ui `PageScreen.kt` |
| Seiten-Icon (Emoji) | ✅ | ✅ (einfache Auswahl) | Web `components/IconPicker.vue`; ui `PageScreen.kt`; core `LocalStore.setIcon` |
| Seitencover anzeigen | ✅ | ✅ | Web `components/PageCover.vue`; ui `PageCover.kt` |
| Seitencover ändern | ✅ | ❌ | Web `components/PageCover.vue` |
| Tags anzeigen/hinzufügen/entfernen | ✅ | ✅ | Web `components/TagBar.vue`; ui `TagRow.kt`; core `LocalStore.addTag`/`removeTag` |
| Seiten nach Tag | ✅ | ❌ | Web `views/TagView.vue` |
| Versionsverlauf | ✅ | ❌ | Web `views/HistoryView.vue`, `editor/version-diff.ts` |

## Editor

| Feature | Web | Native App | Dateien |
| --- | --- | --- | --- |
| Blocktypen anzeigen (Absatz, H1–H3, Listen, To-do, Toggle, Zitat, Code, Trenner, Hinweis) | ✅ | ✅ | Web `editor/PageEditor.vue`; ui `PageScreen.kt` (`BlockView`) |
| Bild-Block anzeigen (offline gecacht) | ✅ | ✅ | Web `editor/AttachmentBlock.vue`, `local/offline-attachments.ts`; ui `ImageBlock.kt` |
| Datei-Block | ✅ | 🟡 nur Platzhalter | Web `editor/AttachmentBlock.vue`; ui `PageScreen.kt` |
| Anhänge hochladen (Bild/Datei) | ✅ | ❌ (`ApiClient.uploadAttachment` existiert, nur im Test genutzt) | Web `editor/AttachmentBlock.vue`, `sync/engine.ts` |
| Text bearbeiten | ✅ WYSIWYG | 🟡 Rohtext (Markdown) im Bearbeitungsmodus | Web `editor/PageEditor.vue`, `editor/inline-dom.ts`; ui `PageScreen.kt` (`BlockEditor`) |
| Formatierung per Toolbar/Shortcut (fett, kursiv, Link) | ✅ | ❌ (nur Markdown tippen) | Web `editor/PageEditor.vue` |
| Seitenlink einfügen (Auswahl) | ✅ | ❌ (Links werden angezeigt und sind antippbar) | Web `editor/PagePicker.vue` |
| Enter teilt Block, leerer Listenpunkt beendet Liste | ✅ | ✅ | Web `editor/PageEditor.vue`; ui `PageScreen.kt` |
| Rücktaste am Blockanfang (umwandeln/verbinden) | ✅ | 🟡 nur wenn die Tastatur die Taste meldet | Web `editor/PageEditor.vue`; ui `PageScreen.kt`; core `LocalStore.mergeBlocks` |
| Slash-Menü | ✅ (inkl. Bild/Datei, Seitenlink) | 🟡 ohne Bild/Datei und Seitenlink | Web `editor/SlashMenu.vue`, `editor/slash.ts`; ui `PageScreen.kt` (`slashKinds`) |
| Markdown-Kürzel am Zeilenanfang | ✅ | ✅ | Web `editor/PageEditor.vue`; ui `PageScreen.kt` (`markdownShortcuts`) |
| Einrücken/Ausrücken | ✅ (Tab) | ✅ (Knöpfe) | ui `PageScreen.kt` |
| Block verschieben | ✅ (Drag am Griff) | ✅ (hoch/runter) | Web `editor/PageEditor.vue`; core `LocalStore.moveBlockBy` |
| Block duplizieren | ✅ | ❌ | Web `editor/PageEditor.vue` (`duplicate`) |
| Mehrere Blöcke markieren/löschen | ✅ | ❌ | Web `editor/PageEditor.vue`, `e2e/undo-selection.spec.ts` |
| Undo/Redo | ✅ Undo + Redo | 🟡 nur Undo, Verlauf endet bei Änderungen anderer Geräte | Web `editor/history.ts`; ui `PageScreen.kt` |
| To-do abhaken | ✅ | ✅ | ui `PageScreen.kt` |
| Pull während der Eingabe → sichtbarer Konflikt statt Überschreiben | ✅ (über Queue) | ✅ (`staleBase`) | ui `PageScreen.kt`; core `LocalStore.updateBlock`/`renameDocument` |

## Suche und Navigation

| Feature | Web | Native App | Dateien |
| --- | --- | --- | --- |
| Lokale Suche | ✅ MiniSearch-Index | 🟡 SQL `LIKE` über Titel und Text | Web `local/search.ts`, `components/CommandPalette.vue`; core `LocalStore.search`, sq `Content.sq` (`searchDocuments`); ui `SearchScreen.kt` |
| Serversuche (FTS5) | ✅ | ❌ | Web `layouts/WorkspaceLayout.vue` (`api.search`) |
| Befehlspalette / Tastenkürzel | ✅ | — | Web `components/CommandPalette.vue`, `components/ShortcutsDialog.vue`, `shortcuts.ts` |

## Sync, Offline und Status

| Feature | Web | Native App | Dateien |
| --- | --- | --- | --- |
| Sync-Trigger: Start, Vordergrund/Fokus, nach Änderungen, periodisch | ✅ | ✅ | Web `sync/triggers.ts`; ui `AppController.kt`, `MainScreen.kt` |
| Sync im Hintergrund | 🟡 nur bei offener App | ✅ WorkManager ~15 min | android `AndroidPlatform.kt` (`SyncWorker`) |
| Pull-to-refresh / Sync-Knopf | ✅ | ✅ | ui `HomeScreen.kt` |
| Statusanzeige (offline, ausstehend, Fehler, abgelehnt) | ✅ | ✅ | Web `layouts/WorkspaceLayout.vue`; ui `SyncStatusBar.kt` |
| Neu synchronisieren (vollständiger Re-Sync) | ✅ | ✅ | Web `views/AccountView.vue`; ui `HomeScreen.kt` |
| „Alles offline verfügbar machen“ | ✅ (abbrechbar, mit Fortschritt) | 🟡 Fortschritt, nicht abbrechbar | Web `views/AccountView.vue`, `sync/offline.ts`; ui `AppController.kt` (`makeAllOffline`) |
| Konflikte anzeigen | ✅ | ✅ | Web `views/ConflictsView.vue`; ui `ConflictsScreen.kt` |
| Konflikte auflösen | ✅ (inkl. manuell, Seite als Kopie) | 🟡 nur Server/andere Version bei geänderten Blöcken/Seiten | Web `views/ConflictsView.vue`; core `LocalStore.resolveConflict` |
| Speicherplatz/Anhänge-Nutzung anzeigen | ✅ | ❌ | Web `views/AccountView.vue` |
| Info: Server, Geräte-ID, letzter Fehler | 🟡 verteilt in Konto | ✅ Info-Dialog | ui `HomeScreen.kt` |

## Plattform

| Feature | Web | Native App | Dateien |
| --- | --- | --- | --- |
| Installation | ✅ PWA | ✅ APK (Debug, `android-dev`) | Web `install.ts`, `pwa.ts`, `sw/service-worker.ts`; `.github/workflows/android.yml` |
| Push-Benachrichtigungen | ✅ Web Push | ❌ (`PushRegistrar` No-op, FCM fehlt) | Web `push-notifications.ts`; ui `Platform.kt` |
| Hell/dunkel | ✅ (umschaltbar) | 🟡 folgt dem System | Web `theme.ts`, `styles.css`; ui `Theme.kt` |
| Export (Markdown, JSON, ZIP) | ✅ | ❌ | Web `export/*.ts`, `views/ExportView.vue` |
| Import (Export-Dateien, Notion) | ✅ | ❌ | Web `export/import.ts`, `views/ExportView.vue` |
| iOS | ✅ (PWA) | ❌ (Targets deklariert, nicht gebaut) | — |

## Tests

| Bereich | Web | Native App |
| --- | --- | --- |
| Logik-Unit-Tests | `apps/web/src/**/*.test.ts` (Vitest) | `apps/mobile/core/src/jvmTest/`, `commonTest/` |
| Gegen echten Server | `apps/web/src/sync/*.integration.test.ts`, `packages/contract-tests` | `apps/mobile/core/src/jvmTest/.../ServerIntegrationTest.kt` (`NOTION_ALT_SERVER`) |
| UI-Ende-zu-Ende | `apps/web/e2e/*.spec.ts` (Playwright) | `apps/mobile/androidApp/src/test/.../AppSmokeTest.kt` (Robolectric) |
