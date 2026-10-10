#!/usr/bin/env bash
# Runs a backup every BACKUP_INTERVAL_HOURS (default 24), then verifies it with a restore test.
set -uo pipefail
INTERVAL=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
until pg_isready -q; do sleep 2; done
while true; do
  if /usr/local/bin/backup.sh && /usr/local/bin/restore-test.sh; then :; else
    echo '{"level":"error","service":"backup","event":"backup.cycle_failed"}'
  fi
  sleep "$INTERVAL"
done
