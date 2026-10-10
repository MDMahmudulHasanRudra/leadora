#!/usr/bin/env bash
# Disaster-recovery restore (see docs/RUNBOOK.md). DESTRUCTIVE: replaces the target database.
#   restore.sh <db-backup.dump.enc> [files-backup.tar.gz.enc]
# Stop api and worker first so nothing writes during the restore.
set -euo pipefail
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
DB_FILE="${1:?usage: restore.sh <db-backup.dump.enc> [files-backup.tar.gz.enc]}"
FILES_FILE="${2:-}"
UPLOADS="${UPLOADS_DIR:-/data/uploads}"

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "This replaces database '$PGDATABASE' with $DB_FILE. Re-run with CONFIRM_RESTORE=yes to continue." >&2
  exit 2
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$DB_FILE" \
  | pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$PGDATABASE"
echo "database restored from $DB_FILE"

if [ -n "$FILES_FILE" ]; then
  mkdir -p "$UPLOADS"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILES_FILE" | tar -C "$UPLOADS" -xzf -
  echo "files restored from $FILES_FILE into $UPLOADS"
fi
