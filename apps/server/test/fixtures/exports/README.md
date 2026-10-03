# Export-Fixtures

Ein vollständiger Export (ZIP) pro veröffentlichter `schema_version` (ADR 0004). `export-roundtrip.test.ts` importiert jede Datei bei jedem Testlauf in eine frische Instanz und vergleicht das Ergebnis mit dem `workspace.json` des Fixtures.

- Fixtures **nie ändern oder löschen**: Sie belegen, dass alte Exporte importierbar bleiben.
- Neue `schema_version`: Migration in `EXPORT_MIGRATIONS` (`packages/shared/src/import.ts`) ergänzen, dann das neue Fixture erzeugen mit
  `UPDATE_EXPORT_FIXTURES=1 pnpm --filter @notion-alt/server test export-roundtrip` (bestehende Dateien werden nicht überschrieben).
