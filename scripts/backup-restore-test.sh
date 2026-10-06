#!/usr/bin/env bash
# T-BAK-01 against the real Docker Compose stack (nightly job "Backup and restore", docs/operations/backup.md):
# create data, back up while running, wipe everything, restore into an empty volume, verify.
# MODE=local runs the same steps against the built server (`pnpm build`) without Docker.
set -euo pipefail
MODE="${MODE:-docker}"
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-notion-alt-backup-test}"
export ALLOW_REGISTRATION=true
export PORT="${PORT:-8089}"
# BASE: override when the stack runs on another Docker host (nightly on the NAS).
BASE="${BASE:-http://localhost:${PORT}}"
WORK="$(mktemp -d)"
JAR="$WORK/cookies"
cleanup() {
  local status=$?
  if [ "$MODE" = docker ]; then
    [ "$status" -ne 0 ] && docker compose logs --tail=200 || true
    docker compose down -v >/dev/null 2>&1 || true
  fi
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Stack operations for both modes.
start() {
  if [ "$MODE" = docker ]; then
    docker compose up -d --build --wait --wait-timeout 300
  else
    DATA_DIR="$WORK/data" PORT="$PORT" HOST=127.0.0.1 LOG_LEVEL=warn ALLOW_REGISTRATION=true \
      node apps/server/dist/index.js &
    SERVER_PID=$!
    for _ in $(seq 100); do curl -fsS "$BASE/api/ready" >/dev/null 2>&1 && return; sleep 0.2; done
    exit 1
  fi
}
backend() { # runs a server command in the backend environment
  if [ "$MODE" = docker ]; then docker compose exec -T backend node dist/index.js "$@"
  else DATA_DIR="$WORK/data" node apps/server/dist/index.js "$@"; fi
}
copy_out() { # backup dir in the backend -> $WORK/backup
  if [ "$MODE" = docker ]; then docker compose cp "backend:$1" "$WORK/backup"
  else cp -r "$1" "$WORK/backup"; fi
}
wipe() {
  if [ "$MODE" = docker ]; then docker compose down -v
  else kill "$SERVER_PID"; wait "$SERVER_PID" || true; SERVER_PID=; rm -rf "$WORK/data"; fi
}
restore() {
  if [ "$MODE" = docker ]; then
    # Streamed in instead of bind-mounted, so it also works against a remote Docker host.
    tar -C "$WORK/backup" -c . | docker compose run --rm --no-deps -T backend \
      sh -c 'mkdir /tmp/restore && tar -x -C /tmp/restore && node dist/index.js restore /tmp/restore'
  else DATA_DIR="$WORK/data" node apps/server/dist/index.js restore "$WORK/backup"; fi
}

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }
api() { curl -fsS -b "$JAR" -c "$JAR" -H 'content-type: application/json' "$@"; }

echo '--- start stack and create data'
start
api -d '{"email":"backup@example.com","password":"correct horse battery"}' "$BASE/api/auth/register" >/dev/null
WS="$(api "$BASE/api/workspaces" | json 'v.workspaces[0].id')"
DEVICE="$(node -e 'console.log(crypto.randomUUID())')"
DOC="$(node -e 'console.log(crypto.randomUUID())')"
FILE="$(node -e 'console.log(crypto.randomUUID())')"
api -d "{\"id\":\"$DEVICE\",\"name\":\"CI\"}" "$BASE/api/devices" >/dev/null
printf 'backup test attachment' >"$WORK/content.bin"
SHA="$(sha256sum "$WORK/content.bin" | cut -d' ' -f1)"
SIZE="$(wc -c <"$WORK/content.bin" | tr -d ' ')"
op() { # entity id payload
  echo "{\"opId\":\"$(node -e 'console.log(crypto.randomUUID())')\",\"deviceId\":\"$DEVICE\",\"workspaceId\":\"$WS\",\"entity\":\"$1\",\"entityId\":\"$2\",\"kind\":\"create\",\"baseRevision\":null,\"payload\":$3,\"createdAt\":\"2026-01-01T00:00:00Z\"}"
}
OPS="[$(op document "$DOC" '{"parentId":null,"title":"Gesichert","sortKey":"a0","favorite":false,"createdAt":"x"}'),\
$(op block "$(node -e 'console.log(crypto.randomUUID())')" "{\"documentId\":\"$DOC\",\"type\":\"paragraph\",\"content\":\"Inhalt vor dem Backup\",\"attrs\":{},\"sortKey\":\"a0\"}"),\
$(op attachment "$FILE" "{\"documentId\":\"$DOC\",\"name\":\"datei.bin\",\"mimeType\":\"application/octet-stream\",\"size\":$SIZE,\"sha256\":\"$SHA\",\"createdAt\":\"x\"}")]"
api -d "{\"operations\":$OPS}" "$BASE/api/sync/push" | json 'v.results.map(r=>r.status).join(",")'
curl -fsS -b "$JAR" -X PUT -H 'content-type: application/octet-stream' --data-binary @"$WORK/content.bin" \
  "$BASE/api/attachments/$FILE/content"
CURSOR="$(api "$BASE/api/sync/snapshot?workspaceId=$WS" | json 'v.cursor')"

echo '--- backup while running'
BACKUP="$(backend backup | json 'v.dir')"
copy_out "$BACKUP"
test -f "$WORK/backup/manifest.json"

echo '--- empty environment'
wipe

echo '--- restore into a new volume, then start'
restore
start

echo '--- verify'
rm -f "$JAR"
api -d '{"email":"backup@example.com","password":"correct horse battery"}' "$BASE/api/auth/login" >/dev/null
api "$BASE/api/sync/snapshot?workspaceId=$WS" | json 'v.blocks.map(b=>b.content).join("|")' | grep -q 'Inhalt vor dem Backup'
curl -fsS -b "$JAR" "$BASE/api/attachments/$FILE/content" -o "$WORK/restored.bin"
cmp "$WORK/content.bin" "$WORK/restored.bin"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/sync/pull?workspaceId=$WS&cursor=$CURSOR")"
test "$STATUS" = 410 # devices re-sync after a restore
echo 'backup/restore OK'
