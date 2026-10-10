#!/usr/bin/env bash
# Restore test (spec §63: "a backup that has never been restored is not considered verified").
# Decrypts the newest database backup into a scratch database, checks it, then drops it.
# Exit code 0 = verified.
set -euo pipefail

: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
DIR="${BACKUP_DIR:-/backups}"
FILE="${1:-$(ls -1t "$DIR"/leadora-db-*.dump.enc 2>/dev/null | head -n1)}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo '{"level":"error","service":"backup","event":"restore_test.no_backup"}'
  exit 1
fi
SCRATCH="leadora_restore_test_$(date -u +%s)"

log() { printf '{"level":"%s","service":"backup","event":"%s","message":"%s","timestamp":"%s"}\n' "$1" "$2" "$3" "$(date -u +%FT%TZ)"; }
cleanup() { psql -q -d postgres -c "drop database if exists \"$SCRATCH\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -d postgres -c "create database \"$SCRATCH\""
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" | pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH"

# The restored database must have the schema, the migration history, pgvector and real rows.
migrations=$(psql -tA -d "$SCRATCH" -c "select count(*) from drizzle.__drizzle_migrations")
orgs=$(psql -tA -d "$SCRATCH" -c "select count(*) from organizations")
leads=$(psql -tA -d "$SCRATCH" -c "select count(*) from leads")
vector=$(psql -tA -d "$SCRATCH" -c "select count(*) from pg_extension where extname = 'vector'")

if [ "$migrations" -gt 0 ] && [ "$vector" = "1" ] && [ "$orgs" -ge 1 ]; then
  log info restore_test.verified "$(basename "$FILE"): $migrations migrations, $orgs organizations, $leads leads"
else
  log error restore_test.failed "$(basename "$FILE"): migrations=$migrations orgs=$orgs vector=$vector"
  exit 1
fi
