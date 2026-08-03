#!/usr/bin/env bash
set -euo pipefail

deployment_dir="${WORK_COPILOT_DEPLOY_DIR:-/opt/work-copilot}"
backup_dir="${WORK_COPILOT_BACKUP_DIR:-/var/lib/work-copilot/backups}"
environment_file="${deployment_dir}/.env.production"

if [[ ! -r "$environment_file" ]]; then
  echo "production environment file is not readable" >&2
  exit 1
fi

umask 077
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary_backup="$(mktemp "${backup_dir}/.work-copilot-${timestamp}.XXXXXX.dump")"
final_backup="${backup_dir}/work-copilot-${timestamp}.dump"

cleanup() {
  rm -f "$temporary_backup"
}
trap cleanup EXIT

docker compose \
  --project-directory "$deployment_dir" \
  --env-file "$environment_file" \
  exec -T postgres \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$temporary_backup"

mv "$temporary_backup" "$final_backup"
trap - EXIT

find "$backup_dir" -type f -name 'work-copilot-*.dump' -mtime +13 -delete
echo "work-copilot backup created: ${final_backup}"
