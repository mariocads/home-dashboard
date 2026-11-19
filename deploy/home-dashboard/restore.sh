#!/usr/bin/env bash
# Spielt einen Dump aus backup.sh ein: Umzug auf einen neuen Server, Notfall, Restore-Test.
#   ./restore.sh backups/homedash-20270101-031500.dump
# Die Datenbank wird dabei NEU angelegt, der bisherige Inhalt geht verloren.
# TimescaleDB muss auf beiden Seiten dieselbe Version haben (TIMESCALE_TAG in .env).
set -euo pipefail
cd "$(dirname "$0")"

dump="${1:-}"
[[ -n "$dump" && -f "$dump" ]] || { echo "✖ Aufruf: ./restore.sh <datei.dump>"; exit 1; }
[[ -f .env ]] || { echo "✖ .env fehlt – vom alten Server übernehmen oder cp .env.example .env"; exit 1; }

if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "Datenbank homedash wird gelöscht und aus ${dump} neu aufgebaut. Fortfahren? [j/N] " answer
  [[ "$answer" == [jJyY] ]] || { echo "Abgebrochen."; exit 1; }
fi

psql() { docker compose exec -T db psql -U homedash -v ON_ERROR_STOP=1 -q "$@"; }

echo "→ Stoppe web und collector"
docker compose stop web collector 2>/dev/null || true
docker compose up -d --wait db

echo "→ Lege Datenbank neu an"
psql -d postgres -c 'DROP DATABASE IF EXISTS homedash WITH (FORCE)' -c 'CREATE DATABASE homedash'
psql -d homedash -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' -c 'SELECT timescaledb_pre_restore()'

echo "→ Spiele Dump ein"
status=0
docker compose exec -T db pg_restore -U homedash -d homedash --no-owner < "$dump" || status=$?
psql -d homedash -c 'SELECT timescaledb_post_restore()'

readings="$(psql -d homedash -At -c 'SELECT count(*) FROM readings')"
echo "→ ${readings} Messwerte in der Datenbank"
if [[ $status -ne 0 ]]; then
  echo "⚠ pg_restore meldete Fehler (siehe oben). Meldungen zu bereits vorhandener Extension sind harmlos."
fi
echo "✔ Restore fertig. Starten mit: ./deploy.sh"
