# Definition of Done

Eine Aufgabe ist erst erledigt, wenn alle zutreffenden Punkte erfüllt sind.

## Funktion

- [ ] Akzeptanzkriterien der Aufgabe sind erfüllt und überprüft.
- [ ] Produktprinzipien eingehalten (local-first, offline-first, keine stillen Überschreibungen).

## Tests

- [ ] Unit-Tests für neue Logik.
- [ ] Sync-/Konflikt-/Export-relevante Änderungen: passende Fälle aus der [Testmatrix](../testing/test-matrix.md) abgedeckt.
- [ ] CI ist grün.

## Security

- [ ] Eingaben validiert, Autorisierung geprüft (Workspace-Grenzen).
- [ ] Keine Secrets im Code oder in Logs; Push-Payloads ohne Inhalte.
- [ ] Neue Abhängigkeiten geprüft.

## Dokumentation

- [ ] Relevante Doku in `docs/` aktualisiert; Architekturentscheidungen als ADR.
- [ ] `ROADMAP.md` aktualisiert.
- [ ] Nutzer-/Betreiber-Doku (z. B. Deployment, Backup) angepasst, falls betroffen.

## Deployment

- [ ] Reproduzierbar per Docker Compose deploybar.
- [ ] Datenbank-Migrationen vorhanden, vorwärts getestet.
- [ ] Healthchecks funktionieren.
