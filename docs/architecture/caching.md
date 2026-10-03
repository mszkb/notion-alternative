# Cache-Strategie

Was wo zwischengespeichert wird und warum. Grundsatz: **Inhalte** liegen in IndexedDB (Dexie, [ADR 0001](../adr/0001-local-storage.md)) und kommen über den Sync; der **Service Worker** speichert nur die App selbst. API-Antworten werden nie im Service Worker gecacht.

## App-Dateien (Service Worker)

Umsetzung: `apps/web/src/sw/service-worker.ts`, gebaut von `apps/web/service-worker.plugin.ts`.

| Ressource | Strategie | Begründung |
| --- | --- | --- |
| App-Shell (`index.html`, gehashte JS/CSS, Icons, Manifest) | **Precache** bei der Installation, Cache-Name `app-<version>` | App startet ohne Netz |
| Seitenaufrufe (Navigation) | **Network-first**, 3 s Timeout, Fallback auf `index.html` aus dem Cache | neue Releases kommen sofort an; bei nicht erreichbarem Server kein Hängenbleiben |
| `/assets/*` (Dateiname enthält Hash) | **Cache-first**, bei Fehlen nachladen | ändern sich nie |
| übrige statische Dateien (Icons, Manifest) | **Stale-while-revalidate** | sofort verfügbar, im Hintergrund aktualisiert |
| `/api/*` | **nie** im Cache | Daten kommen aus Dexie und dem Sync; keine veralteten Antworten |
| fremde Origins, Nicht-GET | nicht angefasst | – |

- **Version:** Hash über alle gebauten und öffentlichen Dateien. Jede Änderung ergibt eine neue `sw.js`, also eine neue Installation mit eigenem Cache. Alte `app-*`-Caches löscht die neue Version bei der Aktivierung.
- **Update:** Die neue Version wartet, bis die Nutzerin bzw. der Nutzer „Neu laden“ wählt; vorher werden offene Eingaben gespeichert. Der Browser prüft beim Laden und bei Fokus (mindestens stündlich) auf eine neue `sw.js`.
- **Notfall:** Kontoseite → „App-Cache zurücksetzen“ entfernt Service Worker und `app-*`-Caches; IndexedDB bleibt.

## HTTP-Cache-Header (nginx)

| Pfad | `Cache-Control` |
| --- | --- |
| `/index.html`, SPA-Routen | `no-cache` (immer revalidieren) |
| `/sw.js` | `no-cache`; der Browser lädt Service Worker ohnehin am HTTP-Cache vorbei (`updateViaCache: 'imports'`) |
| `/manifest.webmanifest` | `no-cache` |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/icons/*` | `public, max-age=86400` |
| `/api/*` | vom Backend, kein Caching |

Zusammen sorgt das dafür, dass Clients nach einem Deployment beim nächsten Laden bzw. Fokus die neue Version erkennen (E2E: `apps/web/e2e/pwa-offline.spec.ts`).

## Daten (IndexedDB)

- Eine Dexie-Datenbank pro Benutzer mit Seiten, Blöcken, Tags, Offline-Queue und Konflikten ([ADR 0009](../adr/0009-local-data-layer.md)); vollständig lokal, keine Eviction durch die App.
- `navigator.storage.persist()` wird beim ersten Start und nach einer Installation angefragt; ohne Zusage darf der Browser die Daten bei Speichermangel löschen (Hinweis in der Seitenleiste).
- Die Kontoseite zeigt Verbrauch und Quota (`navigator.storage.estimate()`), inklusive App-Cache.

## Anhänge (Phase 5, Grundsätze)

- Anhänge liegen **nicht** im App-Cache, sondern in einem eigenen Cache bzw. IndexedDB-Speicher mit eigenem Namen, damit App-Updates sie nicht verwerfen.
- **Größenlimit** pro Datei und insgesamt (z. B. Anteil der Quota); große Dateien nur auf Abruf, nicht automatisch offline.
- **Eviction** nach LRU nur für bereits auf dem Server gespeicherte Anhänge; nicht synchronisierte Anhänge werden nie verdrängt.
- Explizites „Offline verfügbar machen“ pro Seite für Anhänge, die unterwegs gebraucht werden.
- Verbrauch der Anhänge getrennt in der Speicheranzeige.
