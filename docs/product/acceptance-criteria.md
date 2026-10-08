# Akzeptanzkriterien (MVP)

Der MVP gilt als erreicht, wenn alle Kriterien nachweisbar (idealerweise automatisiert) erfüllt sind. Zuordnung zu Testfällen: [Testmatrix](../testing/test-matrix.md).

| # | Kriterium | Phase |
| --- | --- | --- |
| AC-01 | Ein Nutzer kann auf dem Gerät geladene Dokumente ohne Netzwerkverbindung öffnen und bearbeiten. Mit „Alles offline verfügbar machen“ sind das alle Dokumente ([ADR 0017](../adr/0017-content-on-demand.md)). | 2, 4 |
| AC-02 | Offline vorgenommene Änderungen werden nach Wiederherstellung der Verbindung zuverlässig synchronisiert. | 3 |
| AC-03 | Änderungen auf zwei Geräten werden nicht still verloren. | 3, 7 |
| AC-04 | Ein Nutzer kann den vollständigen Workspace in offenen Formaten exportieren. | 6 |
| AC-05 | Eine frische Installation kann einen Export wieder importieren. | 6 |
| AC-06 | Die PWA kann auf iOS installiert werden und erhält nach Zustimmung Web Push. | 4 |
| AC-07 | Die Anwendung funktioniert auch bei deaktiviertem Push durch Start-/Fokus-Synchronisierung. | 3, 4 |
| AC-08 | Ein Serverausfall verhindert weder das Lesen noch das Bearbeiten bereits lokal gespeicherter Inhalte. | 2, 3 |
| AC-09 | Backups und Restore werden automatisiert getestet. | 7 |
