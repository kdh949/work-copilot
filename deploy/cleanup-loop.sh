#!/bin/sh
set -eu

cleanup_interval="${CLEANUP_INTERVAL_SECONDS:-900}"

case "$cleanup_interval" in
  ''|*[!0-9]*)
    echo "CLEANUP_INTERVAL_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac

if [ "$cleanup_interval" -lt 60 ]; then
  echo "CLEANUP_INTERVAL_SECONDS must be at least 60" >&2
  exit 1
fi

while true; do
  node dist/src/operations/cleanup-main
  sleep "$cleanup_interval"
done
