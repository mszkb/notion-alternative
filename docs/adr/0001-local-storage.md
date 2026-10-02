# 0001 – Lokales Speichermodell

- **Status:** Proposed
- **Datum:** 2026-10-02

## Kontext

Local-first verlangt, dass die lokale Datenbank jederzeit lesbar und bearbeitbar ist – auch ohne Server. Die PWA muss auf Desktop, Android und iOS laufen; Browser-Speicher kann (insbesondere auf iOS) unter Umständen geräumt werden.

## Optionen

1. **SQLite im Browser** (z. B. WASM + OPFS) über einen geeigneten Wrapper – relationale Abfragen, FTS lokal möglich; Reife/Performance von OPFS auf iOS prüfen.
2. **IndexedDB** mit klarer Persistenzstrategie – breit verfügbar; Abfragen und Volltextsuche müssen selbst gebaut werden.

## Offene Fragen

- Verhalten von `navigator.storage.persist()` und Speicher-Eviction auf iOS-PWAs.
- Lokale Volltextsuche: eingebaut (SQLite FTS) vs. separate JS-Bibliothek.
- Migrationsstrategie für das lokale Schema.

## Entscheidung

_Offen (Phase 0)._

## Konsequenzen

_Offen._
