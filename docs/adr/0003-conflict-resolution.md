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

## Nachtrag: Umsetzung (Phase 3, Issue #55)

- **Wer zählt als „konkurrierend“:** nur Änderungen **anderer Geräte** seit der `base_revision`. Die eigenen gequeueten Operationen eines Geräts bauen aufeinander auf und sind nie ein Konflikt.
- **Merge-Regel (auch für Metadaten):** Änderungen an verschiedenen Blöcken sind unabhängig (eigene Revisionen). Ändern zwei Geräte **verschiedene Felder derselben Entität** (z. B. Inhalt vs. Position eines Blocks, Titel vs. Favorit einer Seite), wird angewendet und `merged` gemeldet. Dasselbe Feld, oder Anlegen/Löschen auf einer Seite, ist ein Konflikt. Tags und Tag-Zuordnungen folgen denselben Regeln.
- **Löschen vs. Bearbeiten:** Bearbeiten einer anderswo gelöschten Entität (`deleted`) oder von Blöcken/Tags einer anderswo gelöschten Seite (`parent_deleted`) ist ein Konflikt; Löschen eines anderswo bearbeiteten Blocks ebenso.
- **Konfliktobjekt:** Der Server speichert die nicht angewendete Operation (`local`) und den Serverstand der Entität (`remote`) in `conflicts` und schreibt einen Change mit Entität `conflict` ins Log; alle Geräte erhalten ihn per Pull. Erneutes Senden derselben Operation liefert denselben Konflikt. Auf dem Gerät, dessen Änderung betroffen ist, zeigt die Entität danach wieder den Serverstand; die eigene Fassung steht im Konflikt.
- **Auflösung:** in der Ansicht „Konflikte“ (Seitenleiste, Hinweis auf der Seite, Markierung am Block) mit beiden Fassungen: eigene Änderung übernehmen, Server-Stand behalten oder (bei Text) manuell zusammenführen. Bei Löschkonflikten: als neue Seite wiederherstellen (neue IDs, Tombstones bleiben endgültig) oder Löschung übernehmen. Die gewählte Fassung wird als normale Operation geschrieben, dazu eine `conflict`-`update`-Operation – beides offline möglich. Hat ein anderes Gerät denselben Konflikt bereits aufgelöst, ist das ein `duplicate`, kein neuer Konflikt.
