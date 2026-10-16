#!/bin/sh
# Шифрование и доставка в отдельное хранилище настраиваются оператором.
set -eu
set -C
umask 077
mkdir -p .backups
backup_path=".backups/nox-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$backup_path"
printf '%s\n' "$backup_path"
