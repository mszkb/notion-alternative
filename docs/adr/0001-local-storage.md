# 0001 – Lokales Speichermodell

- **Status:** Accepted
- **Datum:** 2026-10-02

## Kontext

Local-first verlangt, dass die lokale Datenbank jederzeit lesbar und bearbeitbar ist – auch ohne Server. Die PWA muss auf Desktop, Android und iOS laufen; Browser-Speicher kann (insbesondere auf iOS) unter Umständen geräumt werden.

## Optionen

1. **SQLite im Browser** (z. B. WASM + OPFS) über einen geeigneten Wrapper – relationale Abfragen, FTS lokal möglich; Reife/Performance von OPFS auf iOS ungewiss, zusätzliche WASM-Last.
2. **IndexedDB** mit klarer Persistenzstrategie – breit verfügbar und ausgereift, auch auf iOS; Abfragen und Volltextsuche müssen selbst gebaut bzw. per Bibliothek ergänzt werden.

## Entscheidung

**IndexedDB über [Dexie](https://dexie.org/).**

- Dexie als typisierter Wrapper um IndexedDB (Tabellen, Indizes, Transaktionen, Schema-Versionen).
- Offline-Queue (ausstehende Operationen) liegt in derselben IndexedDB, damit Inhaltsänderung und Queue-Eintrag **in einer Transaktion** geschrieben werden.
- Persistenz: Beim ersten Start `navigator.storage.persist()` anfragen und den Status in der UI anzeigen (z. B. Hinweis „Speicher nicht dauerhaft – bitte App installieren“).
- Lokale Volltextsuche über eine JS-Bibliothek; die konkrete Wahl erfolgt in Phase 2.

Begründung: IndexedDB ist auf allen Zielplattformen (inkl. iOS-PWA) verfügbar und erprobt, ohne WASM-Abhängigkeit. Das Risiko unklarer OPFS-Unterstützung auf iOS entfällt.

## Konsequenzen

- Client (IndexedDB) und Server (SQLite, siehe [ADR 0006](0006-tech-stack.md)) haben unterschiedliche Speicher; das gemeinsame Datenmodell wird daher als TypeScript-Typen/Schemas in einem geteilten Paket definiert, nicht als SQL.
- Lokale Schema-Migrationen laufen über Dexie-Versionen; ungesyncte Queue-Einträge müssen Migrationen überstehen (Testfall T-MIG-02).
- Volltextsuche lokal braucht einen eigenen Index, der bei Änderungen aktualisiert wird.
- Eviction-Risiko auf iOS bleibt bestehen und wird durch Sync + Export abgefedert; Verhalten wird in Phase 4 auf echten Geräten getestet.
