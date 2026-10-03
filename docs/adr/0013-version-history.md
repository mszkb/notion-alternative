# 0013 – Versionsverlauf

- **Status:** Accepted
- **Datum:** 2026-10-03

## Kontext

Phase 5 verlangt einen Verlauf pro Seite mit Diff und Wiederherstellung (Issues #65, #66). Der Server führt seit Phase 3 ein vollständiges Änderungslog (`changes`) mit Revisionen pro Entität; im MVP wird es nicht kompaktiert ([ADR 0002](0002-sync-protocol.md)). Der JSON-Export soll den Verlauf enthalten ([ADR 0004](0004-export-format.md)).

## Optionen

1. **Verlauf aus dem Änderungslog ableiten.** **+** Kein zusätzlicher Speicher, jede Änderung ist bereits mit Zeit und Gerät da, Rekonstruktion deterministisch. **−** Rekonstruktion kostet Rechenzeit proportional zur Länge des Verlaufs; eine spätere Kompaktierung muss den Verlauf berücksichtigen.
2. **Eigene Snapshots pro Seite** (z. B. nach jeder Sitzung). **+** Schneller Zugriff auf alte Stände. **−** Doppelte Datenhaltung, zusätzlicher Schreibpfad, Speicherwachstum.

## Entscheidung

Option 1.

- **Version = Bearbeitungssitzung:** aufeinanderfolgende Changes an der Seite und ihren Blöcken vom selben Gerät mit höchstens 10 Minuten Abstand bilden eine Version; ihr Zeitpunkt ist der letzte Change, ihre Kennung dessen `seq`.
- **Rekonstruktion:** Der Stand zu `seq` N entsteht, indem alle Changes der Seite und ihrer Blöcke bis einschließlich N in Reihenfolge angewendet werden (`create` setzt alle Felder, `update`/`move` die geänderten, `delete` setzt den Tombstone). Konfliktobjekte ändern keinen Stand.
- **Endpunkte:** `GET /api/documents/:id/history` (Versionen, neueste zuerst) und `GET /api/documents/:id/history/:seq` (Seite und Blöcke zu diesem Stand), nur im eigenen Workspace.
- **Wiederherstellen** ([#66](https://github.com/mszkb/notion-alternative/issues/66)) erzeugt **neue** Operationen auf dem aktuellen Stand (wie Undo, `LocalStore.applyBlockState`); die Historie wird nie zurückgedreht, gleichzeitige Änderungen anderer Geräte laufen über den normalen Konfliktpfad.
- **Aufbewahrung:** Solange es keine Kompaktierung gibt, bleibt der vollständige Verlauf erhalten. Eine spätere Kompaktierung (`compacted_seq`) darf Verlauf nur entfernen, wenn dafür vorher ein Snapshot der betroffenen Seiten als Ausgangspunkt gespeichert wird; bis dahin sind Versionen vor `compacted_seq` nicht abrufbar, die UI sagt das.

## Konsequenzen

- Kein neues Schema; Verlauf ist nur mit Serververbindung abrufbar (lokal liegen keine Changes vor). Die UI zeigt offline einen Hinweis.
- Bei sehr langen Verläufen kann die Rekonstruktion teuer werden; dann Snapshots als Cache ergänzen (Option 2 als Optimierung, nicht als Quelle).
- Der JSON-Export (#69) kann die Versionsliste und die Changes je Seite übernehmen.
