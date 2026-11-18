#!/usr/bin/env bash
# Nächtliches Backup der Datenbank. Cron-Beispiel (crontab -e):
#   15 3 * * * /opt/stacks/home-dashboard/backup.sh >> /var/log/home-dashboard-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

mkdir -p backups
file="backups/homedash-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U homedash -d homedash -Fc > "$file"
echo "$(date -Iseconds) ✔ Dump: $file ($(du -h "$file" | cut -f1))"

# Lokal 14 Tage aufbewahren
find backups -name 'homedash-*.dump' -mtime +14 -delete

# Optional: zusätzlich extern mit restic sichern
if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  restic backup backups --tag home-dashboard
  restic forget --tag home-dashboard --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
fi
