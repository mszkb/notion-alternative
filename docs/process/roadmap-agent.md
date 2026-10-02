# Aufgaben des Roadmap-Agenten

Die ursprüngliche Spezifikation richtet sich an einen Roadmap-Agenten. Dessen Aufgaben:

1. **Zerlegung:** Jede Phase in Epics, Issues, technische Tasks, UX-Aufgaben und Dokumentationsaufgaben zerlegen.
2. **Aufgabenbeschreibung:** Für jede Aufgabe Scope, Abhängigkeiten, Risiken, Aufwand und überprüfbare Akzeptanzkriterien definieren (Vorlage unten).
3. **ADRs** für lokales Speichermodell, Sync-Protokoll, Konfliktauflösung, Exportformat und Push erstellen → [`docs/adr/`](../adr/README.md).
4. **Milestones** anlegen: Prototype, Offline MVP, Beta, Stable, Collaboration → [`ROADMAP.md`](../../ROADMAP.md).
5. **Testmatrizen** für offline/online, mehrere Geräte, Konflikte, Löschungen, Backups und Migrationen → [`docs/testing/test-matrix.md`](../testing/test-matrix.md).
6. **Definition of Done** inkl. Tests, Security, Dokumentation und reproduzierbarem Deployment → [`definition-of-done.md`](definition-of-done.md).

## Issue-Vorlage

```markdown
## Kontext
Phase: <0–9> · Milestone: <Prototype | Offline MVP | Beta | Stable | Collaboration>
Typ: <Epic | Technik | UX | Doku>

## Scope
Was gehört dazu – und explizit nicht?

## Abhängigkeiten
- #…

## Risiken
- …

## Aufwand
<S | M | L | XL>

## Akzeptanzkriterien
- [ ] …
- [ ] Definition of Done erfüllt
```
