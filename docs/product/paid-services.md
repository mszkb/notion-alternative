# Paid services – Konzeptentwurf (Phase 9)

> **Status: Entwurf.** Das Dokument sammelt Vorschläge und offene Fragen zu den Issues [#82](https://github.com/mszkb/notion-alternative/issues/82)–[#86](https://github.com/mszkb/notion-alternative/issues/86). Entschieden ist noch nichts. Geschäftsmodell, Preise und Betrieb legt der Maintainer fest; technische Entscheidungen bekommen eigene ADRs.

## Leitplanken

Die Leitplanken gelten für alle Dienste:

- **Keine künstlichen Feature-Sperren:** Die self-hosted Version bleibt vollständig. Jeder Paid-Dienst ist eine Bequemlichkeit (Betrieb, Off-site, Zustellung), nie eine Voraussetzung für Kernfunktionen.
- **Kein Lock-in:** Export (Markdown, JSON, ZIP) und Umzug zwischen hosted und self-hosted funktionieren jederzeit in beide Richtungen, über Export/Import ([ADR 0004](../adr/0004-export-format.md)) oder Backup/Restore ([`backup.md`](../operations/backup.md)).
- **Datensparsamkeit:** Dienste sehen so wenig wie möglich. Wo es geht, verschlüsselt der Nutzer mit eigenem Schlüssel. Was ein Dienst an Metadaten sieht, steht in der Doku.
- **Gleicher Code:** Hosted-Instanzen laufen mit denselben Images wie self-hosted (`linux/amd64` und `linux/arm64`).

## Dienste

### Hosted Push Relay (#83)

**Problem:** Eine Installation ohne öffentlich erreichbaren Server kann Web Push trotzdem selbst senden. Der Server baut die Verbindung zum Push-Dienst ausgehend auf ([ADR 0005](../adr/0005-push.md)). Ein Relay hilft nur, wenn ausgehende Verbindungen zu den Push-Diensten gesperrt sind oder ein Betreiber keine VAPID-Schlüssel verwalten will.

**Vorschlag:**

- Der self-hosted Server schickt dem Relay die bereits nach RFC 8291 verschlüsselte Nachricht samt Subscription-Endpunkt. Das Relay leitet nur weiter.
- Das Relay sieht dabei weder Inhalt noch Workspace-ID, weil der Payload ohnehin keine Inhalte enthält und verschlüsselt ist.
- Die Installation authentifiziert sich mit einem eigenen Token. Mengenlimits gelten pro Token.
- **Metadaten:** Das Relay sieht, wann welche Installation an welche Push-Endpunkte sendet. Das wird dokumentiert.

**Frage:** Lohnt sich das Relay angesichts von „Push ist nur ein Hinweis“ überhaupt? Alternative: zuerst nur dokumentieren, welche Hosts freigegeben sein müssen (`PUSH_ALLOWED_HOSTS`).

### Managed Backups (#84)

**Vorschlag:**

- Das bestehende Backup (`node dist/index.js backup`, Manifest mit SHA-256) wird vor dem Upload clientseitig verschlüsselt, mit age oder libsodium in einem eigenen ADR. Der Schlüssel bleibt beim Nutzer.
- Ziel ist ein S3-kompatibler Bucket des Dienstes mit Aufbewahrungsregeln.
- Restore lädt herunter, entschlüsselt und nutzt danach den unveränderten `restore`-Befehl.
- Ohne den Dienst bleibt die Off-site-Kopie mit restic oder rclone ([`backup.md`](../operations/backup.md#off-site-kopie)) gleichwertig.

**Akzeptanz:** Restore-Test aus einem Managed Backup in CI, mit einem lokalen S3 wie im Job `s3`.

### Hosted Sync (#82) und Hosting (#85)

**Vorschlag:** Eine eigene Instanz pro Kunde auf Basis des Docker-Compose-Stacks, keine Mandantenfähigkeit in einer gemeinsamen Datenbank.

- Begründung: Die Isolation entspricht der von self-hosted. Backup, Restore und Umzug sind dieselben Befehle. Es gibt kein Risiko, dass Daten zwischen Mandanten durchsickern.
- Der Preis dafür ist mehr Betriebsaufwand pro Kunde (Updates, Monitoring).
- „Hosted Sync“ und „Hosting“ fallen damit praktisch zusammen: Die App wird ohnehin vom selben Stack ausgeliefert.

**Umzug:**

- Self-hosted → hosted: Backup hochladen, Restore. Geräte bekommen `410` und synchronisieren neu ([`sync.md`](../architecture/sync.md)).
- Hosted → self-hosted: genauso, mit dem Backup aus dem Dienst. Beides wird getestet (Akzeptanzkriterium #85).

**Offen:**

- Ende-zu-Ende-Verschlüsselung: Damit wären serverseitige Suche (FTS5), Verlauf und Merge auf dem Server nicht mehr möglich. Das bräuchte ein eigenes ADR und wäre ein großer Umbau.
- Abrechnung, DSGVO-Auftragsverarbeitung, Standort.

### Team-Governance (#86)

Setzt Phase 8 voraus ([ADR 0014](../adr/0014-sharing-and-permissions.md)). Mögliche Inhalte:

- Rollen-Vorlagen für neue Workspaces.
- Pflicht zum regelmäßigen Export oder Backup (Erinnerung, kein Zwang).
- Übersicht der Mitglieder über alle Workspaces einer Installation.

SSO/SCIM und Audit-Logs bleiben Nicht-Ziele. Sie werden neu bewertet, wenn Phase 8 umgesetzt ist.

## Offene Fragen an den Maintainer

1. Soll es Paid services überhaupt geben, und wer betreibt sie?
2. Soll Hosting eine eigene Instanz pro Kunde sein (Vorschlag) oder mandantenfähig?
3. Wird Ende-zu-Ende-Verschlüsselung für Hosted Sync verlangt? Davon hängt ab, ob serverseitige Suche und Verlauf dort entfallen.
4. Welche Reihenfolge? Vorschlag: Managed Backups → Hosting → Push Relay (nur bei Bedarf) → Governance nach Phase 8.
