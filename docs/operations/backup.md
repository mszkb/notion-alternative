# Backup, Restore und Upgrade

Anleitung für den Docker-Compose-Stack ([Deployment](deployment.md)). Alle Befehle im Verzeichnis mit der `docker-compose.yml` ausführen. Dieselben Befehle laufen in CI bei jedem Push gegen den echten Stack (`scripts/backup-restore-test.sh`, Job `backup`, T-BAK-01).

## Was gesichert wird

| Teil | Im Backup | Hinweis |
| --- | --- | --- |
| SQLite-Datenbank (`/data/app.sqlite`) | ja | Konten (Passwort-Hashes), Sitzungen, Geräte, Workspaces, Seiten, Blöcke, Tags, Änderungslog, Verlauf, Papierkorb, Konflikte, Anhang-Metadaten, Push-Subscriptions und VAPID-Schlüssel |
| Dateianhänge im Volume (`/data/attachments`) | ja | nur Anhänge, deren Datei vorhanden ist; fehlende stehen in `manifest.json` unter `missingAttachments` |
| `.env` | **nein** | liegt auf dem Host; separat sichern (enthält ggf. S3-Zugangsdaten) |
| Anhänge in S3 (`ATTACHMENT_STORAGE=s3`) | **nein** | Bucket selbst sichern (Versionierung, `rclone sync`); möglichst zeitnah zum Datenbank-Backup |
| Ungesynchronisierte Änderungen auf Geräten | nein | liegen nur im Browser (IndexedDB) und werden nach einem Restore erneut gesendet, siehe [Clients nach einem Restore](#clients-nach-einem-restore) |

Das Backup enthält Passwort-Hashes, gültige Sitzungen und den privaten VAPID-Schlüssel: wie Zugangsdaten behandeln (nur für den Betreiber lesbar, Off-site-Kopie verschlüsselt).

Jedes Gerät hat außerdem eine vollständige lokale Kopie seiner Workspaces. Sie ersetzt kein Backup, hilft aber, wenn das letzte Backup älter ist als der letzte Sync. Zusätzlich lässt sich jeder Workspace in der App als ZIP exportieren ([Export](../user/export.md)); das ist unabhängig vom Server wieder importierbar.

## Backup erstellen

Im laufenden Betrieb (SQLite-Online-Backup, konsistent auch während Schreibzugriffen):

```sh
docker compose exec -T backend node dist/index.js backup
# {"dir":"/data/backups/backup-2026-10-03T18-00-00-000Z","files":3,"missing":[]}
```

Das Backup liegt zunächst **im selben Volume** wie die Daten und ist damit noch kein Schutz gegen Datenverlust. Auf den Host kopieren und im Volume löschen:

```sh
dir=/data/backups/backup-2026-10-03T18-00-00-000Z   # "dir" aus der Ausgabe
mkdir -p ~/notion-alt-backups
docker compose cp "backend:$dir" ~/notion-alt-backups/
docker compose exec -T backend rm -rf "$dir"
```

Ein Backup ist ein Verzeichnis:

```text
backup-2026-10-03T18-00-00-000Z/
├── manifest.json        # Format, Zeitpunkt, Migrationsstand, Größe und SHA-256 jeder Datei
├── app.sqlite
└── attachments/<workspace-id>/<anhang-id>
```

Ein Backup wird unter `*.partial` geschrieben und erst am Ende umbenannt; ein Verzeichnis ohne `.partial` ist vollständig.

## Automatisieren

Skript auf dem Host, z. B. `~/notion-alt-backup.sh` (Pfade anpassen, `chmod 700`):

```sh
#!/bin/sh
set -eu
cd ~/notion-alternative
target=~/notion-alt-backups
mkdir -p "$target"
dir=$(docker compose exec -T backend node dist/index.js backup \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).dir))")
docker compose cp "backend:$dir" "$target/"
docker compose exec -T backend rm -rf "$dir"
# Keep the last 14 backups.
ls -1d "$target"/backup-* | head -n -14 | xargs -r rm -rf
```

Falls `node` auf dem Host fehlt, die Ausgabe stattdessen mit `sed -n 's/.*"dir":"\([^"]*\)".*/\1/p'` auslesen.

**cron** (täglich 3:15 Uhr, `crontab -e`):

```text
15 3 * * * $HOME/notion-alt-backup.sh >>$HOME/notion-alt-backup.log 2>&1
```

**systemd-Timer** (als Benutzer, auch mit rootless Docker; `~/.config/systemd/user/`):

```ini
# notion-alt-backup.service
[Unit]
Description=notion-alternative backup

[Service]
Type=oneshot
ExecStart=%h/notion-alt-backup.sh
```

```ini
# notion-alt-backup.timer
[Unit]
Description=Daily notion-alternative backup

[Timer]
OnCalendar=*-*-* 03:15
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now notion-alt-backup.timer
loginctl enable-linger "$USER"   # timer also runs without an active login
systemctl --user list-timers      # next run
journalctl --user -u notion-alt-backup.service   # last runs
```

## Off-site-Kopie

Ein Backup auf demselben Host schützt nicht vor Diskausfall, Diebstahl oder Ransomware. Mindestens eine Kopie auf einem anderen Gerät oder bei einem Speicheranbieter halten, verschlüsselt, z. B.:

- **restic** (verschlüsselt, dedupliziert): `restic -r sftp:backup-host:/srv/notion-alt backup ~/notion-alt-backups`
- **rclone** mit `crypt`-Remote: `rclone sync ~/notion-alt-backups secret:notion-alt`
- **rsync** auf einen eigenen Rechner: `rsync -a --delete ~/notion-alt-backups/ backup-host:notion-alt-backups/`

Den Befehl an das Ende des Backup-Skripts hängen. Mit `ATTACHMENT_STORAGE=s3` den Bucket ebenfalls off-site sichern (Versionierung beim Anbieter oder `rclone sync s3:bucket …`).

## Backup prüfen

`manifest.json` enthält Größe und SHA-256 jeder Datei. Ohne die App prüfen:

```sh
cd ~/notion-alt-backups/backup-2026-10-03T18-00-00-000Z
node -e "const m=require('./manifest.json');for(const f of m.files)console.log(f.sha256+'  '+f.path)" | sha256sum -c --quiet && echo OK
```

Der Restore prüft dasselbe selbst und bricht bei der ersten fehlenden oder veränderten Datei ab, bevor er etwas überschreibt. Der beste Test bleibt ein **Probe-Restore** in eine leere Umgebung (unten, mit eigenem `COMPOSE_PROJECT_NAME` und anderem `PORT`), z. B. einmal im Quartal und nach jedem größeren Upgrade.

## Restore

Der Restore läuft bei gestopptem Backend in einem einmaligen Container mit demselben Volume. Er prüft das Backup, kopiert Datenbank und Anhänge, migriert die Datenbank auf den aktuellen Stand und sorgt dafür, dass alle Geräte neu synchronisieren.

```sh
backup=~/notion-alt-backups/backup-2026-10-03T18-00-00-000Z
chmod -R a+rX "$backup"            # the container runs as user "node"
docker compose stop frontend backend
docker compose run --rm --no-deps -v "$backup:/restore:ro" backend node dist/index.js restore /restore
# {"restored":"/restore","attachments":1}
docker compose up -d --wait
```

- **In eine leere Umgebung** (neuer Host, gelöschtes Volume): wie oben; das Volume entsteht beim `run`. Vorher `.env` wiederherstellen und mit `docker compose build` (oder `up -d --build` und danach `stop`) die Images bauen.
- **Über vorhandene Daten:** Der Restore verweigert das Überschreiben einer vorhandenen Datenbank. Bewusst ersetzen mit `restore /restore --force`. Vorher von den aktuellen Daten ein Backup ziehen, falls noch möglich.
- **Mit S3:** Der Restore schreibt nur die Datenbank (das Backup enthält keine Anhänge). Den Bucket auf den passenden Stand bringen; fehlende Objekte zeigt die App als „nicht verfügbar“ an.
- **Fehler** (`Checksum mismatch`, `File missing`, `no valid backup`): Das Backup ist beschädigt; nichts wurde verändert. Ein anderes Backup verwenden.

Nach dem Start: anmelden, eine Seite mit Anhang öffnen, `curl -fsS http://127.0.0.1:8080/api/ready`.

### Was nach einem Restore gilt

Der Server steht auf dem Stand des Backups. Was danach auf dem Server geschah, ist dort weg:

- **Konten und Passwörter:** Nach dem Backup angelegte Konten fehlen, nach dem Backup geänderte Passwörter gelten wieder in der alten Fassung.
- **Sitzungen:** Sitzungen aus der Zeit vor dem Backup sind wieder gültig, spätere nicht; betroffene Geräte melden sich neu an (lokale Daten bleiben).
- **Geräte:** Nach dem Backup registrierte Geräte melden sich beim nächsten Online-Start automatisch wieder an. Nach dem Backup **entfernte** Geräte sind wieder aktiv: auf der Kontoseite erneut entfernen.
- **Push:** VAPID-Schlüssel und Subscriptions stammen aus dem Backup; nach dem Backup aktivierte Benachrichtigungen auf dem Gerät erneut einschalten.

### Clients nach einem Restore

Die Geräte haben meist einen neueren Stand als das Backup. Der Restore hebt die Sync-Nummerierung an, deshalb beantwortet der Server den nächsten Delta-Pull jedes Geräts mit `410`, und das Gerät synchronisiert vollständig neu ([Sync: Restore eines älteren Server-Backups](../architecture/sync.md)):

1. Das Gerät sendet zuerst seine Warteschlange (Offline-Änderungen).
2. Es lädt den Snapshot des Servers. Seiten, Blöcke und Tags, die der Server nicht mehr kennt, sendet es erneut als neu angelegt; ist sein Stand neuer als der des Servers, sendet es die Unterschiede. Der Server merged sie oder zeigt einen Konflikt an. Nichts wird still verworfen.
3. Anhänge, die der Server nicht mehr kennt, meldet das Gerät erneut an und lädt die Datei hoch, sofern es sie lokal hat.

Damit kommt der Stand nach dem Backup von den Geräten zurück, sobald jedes Gerät einmal online war. Geräte, deren lokale Daten gelöscht wurden, können nichts beitragen. Die Seitenleiste zeigt nach dem Neu-Synchronisieren eventuell Konflikte zur Entscheidung an.

## Upgrade

Datenbank-Migrationen laufen beim Start des Backends automatisch und nur vorwärts; eine ältere Version kann eine migrierte Datenbank nicht öffnen. Deshalb vor jedem Update ein Backup:

```sh
cd ~/notion-alternative
~/notion-alt-backup.sh                     # or the commands under "Backup erstellen"
git fetch && git log --oneline HEAD..origin/main   # what's new
git pull
docker compose up -d --build --wait
docker compose logs --tail=50 backend      # migrations ran, no errors
curl -fsS http://127.0.0.1:8080/api/ready
```

Geräte erhalten die neue App-Version beim nächsten Öffnen („Eine neue Version ist verfügbar – Neu laden“). Lokale Daten der Geräte werden bei Bedarf im Browser migriert, die Warteschlange bleibt erhalten.

**Zurück zur alten Version** (Upgrade fehlgeschlagen):

```sh
git checkout <vorheriger Commit>
docker compose build
docker compose stop frontend backend
docker compose run --rm --no-deps -v "$backup:/restore:ro" backend node dist/index.js restore /restore --force
docker compose up -d --wait
```

Änderungen, die Geräte zwischen Upgrade und Rückkehr gesendet haben, kommen wie nach jedem Restore von den Geräten zurück.
