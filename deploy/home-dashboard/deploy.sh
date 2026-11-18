#!/usr/bin/env bash
# Aktualisiert das Home Dashboard auf das gewünschte Image-Tag.
#   ./deploy.sh            → Tag aus .env (Standard: main)
#   ./deploy.sh sha-1a2b3c → bestimmtes Tag (auch für Rollback)
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || { echo "✖ .env fehlt – cp .env.example .env"; exit 1; }

if [[ $# -ge 1 ]]; then
  export TAG="$1"
fi
current_tag="${TAG:-$(grep -E '^TAG=' .env | cut -d= -f2 || echo main)}"
echo "→ Deploy mit TAG=${current_tag}"

docker compose pull web collector
docker compose up -d --remove-orphans

echo "→ Warte auf Healthcheck…"
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q web)" 2>/dev/null || echo unknown)"
  if [[ "$status" == "healthy" ]]; then
    echo "$(date -Iseconds) ${current_tag}" >> .deploy-history
    docker compose ps
    echo "✔ Deploy erfolgreich (${current_tag})"
    exit 0
  fi
  sleep 2
done

echo "✖ web ist nicht healthy geworden. Logs:"
docker compose logs --tail 50 web
echo "Rollback: ./deploy.sh <vorheriges Tag> (siehe .deploy-history)"
exit 1
