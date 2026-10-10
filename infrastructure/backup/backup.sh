#!/usr/bin/env bash
# Encrypted backup of PostgreSQL and uploaded files (spec §63).
#   - pg_dump custom format (compressed), encrypted with AES-256-CBC + PBKDF2 using BACKUP_PASSPHRASE
#   - the uploads directory as a tarball, encrypted the same way
#   - files older than BACKUP_RETENTION_DAYS are deleted
# Copy /backups off the host (rclone, S3 sync, …): a backup on the same disk is not a backup.
set -euo pipefail

: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}"
DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
UPLOADS="${UPLOADS_DIR:-/data/uploads}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DIR"

log() { printf '{"level":"info","service":"backup","event":"%s","message":"%s","timestamp":"%s"}\n' "$1" "$2" "$(date -u +%FT%TZ)"; }
encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$1"; }

DB_FILE="$DIR/leadora-db-$STAMP.dump.enc"
pg_dump --format=custom --compress=6 --no-owner --no-privileges | encrypt "$DB_FILE.partial"
mv "$DB_FILE.partial" "$DB_FILE"
log backup.db_done "$(basename "$DB_FILE") $(du -h "$DB_FILE" | cut -f1)"

if [ -d "$UPLOADS" ]; then
  FILES_FILE="$DIR/leadora-files-$STAMP.tar.gz.enc"
  tar -C "$UPLOADS" -czf - . | encrypt "$FILES_FILE.partial"
  mv "$FILES_FILE.partial" "$FILES_FILE"
  log backup.files_done "$(basename "$FILES_FILE") $(du -h "$FILES_FILE" | cut -f1)"
fi

find "$DIR" -name 'leadora-*.enc' -type f -mtime "+$RETENTION" -print -delete | while read -r f; do log backup.pruned "$(basename "$f")"; done
log backup.completed "$STAMP"
