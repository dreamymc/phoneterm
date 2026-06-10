#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOG_FILE="conduit.log"

if [ -f "$LOG_FILE" ]; then
  FILE_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$FILE_SIZE" -gt 5242880 ]; then
    mv "$LOG_FILE" "${LOG_FILE}.old"
  fi
fi

exec node server/index.js >> "$LOG_FILE" 2>&1
