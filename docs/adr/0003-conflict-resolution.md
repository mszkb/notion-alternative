# 0003 – Konfliktauflösung

- **Status:** Accepted
- **Datum:** 2026-10-02

## Kontext

Prinzip: Konflikte werden sichtbar und nachvollziehbar behandelt, nicht still überschrieben. Einfaches Last-write-wins ist ausgeschlossen.

## Optionen

1. **Block-Merge + manuelle Konfliktauflösung** – Änderungen an unterschiedlichen Blöcken automatisch zusammenführen; Änderungen am selben Block als Konflikt anzeigen (beide Stände erhalten).
2. **CRDT** (z. B. Yjs/Automerge) – automatische Zusammenführung auch innerhalb eines Blocks; Grundlage für spätere Echtzeit-Kollaboration, aber höhere Komplexität und Exportanforderungen.
3. **Operation-based Sync** (OT-ähnlich) – serverseitige Transformation.

## Entscheidung

**Option 1 – Block-Merge mit sichtbarer Konfliktanzeige** für den MVP.

- Jede Operation trägt die `base_revision` des betroffenen Blocks.
- Passt die `base_revision` zur aktuellen Revision → Operation wird angewendet.
- Betrifft eine Operation einen anderen Block als die konkurrierende Änderung → automatischer Merge.
- Betreffen zwei Operationen **denselben Block** (oder Löschen vs. Bearbeiten) → Konflikt-Objekt mit beiden Ständen; die Nutzerin bzw. der Nutzer entscheidet in der UI. Bis dahin geht kein Stand verloren.

## Konsequenzen

- Blöcke brauchen **stabile IDs** und eigene Revisionen; das Datenmodell ([sync.md](../architecture/sync.md)) muss das abbilden.
- Reihenfolge von Blöcken innerhalb eines Dokuments wird über einen sortierbaren Schlüssel (z. B. fraktionale Indizes) gespeichert, damit Einfügen/Verschieben auf verschiedenen Geräten nicht kollidiert. Details in [ADR 0002](0002-sync-protocol.md).
- Eine Konflikt-UI ist Teil von Phase 3.
- CRDT/operation-based Sync bleibt für Phase 8 (Echtzeit) möglich; das Datenmodell darf das nicht verbauen (stabile IDs, Operationen statt Snapshots).
- Abgedeckte Testfälle: T-MD-02, T-MD-03, T-DEL-02.
