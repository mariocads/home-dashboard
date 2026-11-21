#!/usr/bin/env bash
# Aktualisiert das Home Dashboard auf das gewünschte Image-Tag.
#   ./deploy.sh            → Tag aus .env (Standard: main); holt vorher die aktuellen Deploy-Dateien
#   ./deploy.sh sha-1a2b3c → bestimmtes Tag (auch für Rollback); Deploy-Dateien bleiben wie sie sind
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || { echo "✖ .env fehlt – cp .env.example .env"; exit 1; }

# Deploy-Dateien (compose.yml, Skripte) aus dem Sparse-Checkout des Repos übernehmen. Neue
# Variablen in compose.yml kommen sonst nie im Container an. Die .env wird nie angefasst.
REPO_DIR="${REPO_DIR:-../repo}"
FILES=(compose.yml deploy.sh backup.sh restore.sh .env.example)
if [[ $# -eq 0 && -z "${HD_DEPLOY_UPDATED:-}" ]]; then
  if [[ -d "$REPO_DIR/.git" ]]; then
    echo "→ Hole aktuelle Deploy-Dateien aus $REPO_DIR"
    if git -C "$REPO_DIR" pull --ff-only --quiet; then
      changed=()
      for f in "${FILES[@]}"; do
        src="$REPO_DIR/deploy/home-dashboard/$f"
        [[ -f "$src" ]] || continue
        if ! cmp -s "$src" "$f"; then
          # Erst kopieren, dann umbenennen: Das laufende Skript liest weiter aus der alten Datei.
          cp "$src" "$f.new"
          [[ "$f" == *.sh ]] && chmod +x "$f.new"
          mv "$f.new" "$f"
          changed+=("$f")
        fi
      done
      if [[ ${#changed[@]} -gt 0 ]]; then
        echo "  aktualisiert: ${changed[*]}"
        if [[ " ${changed[*]} " == *" deploy.sh "* ]]; then
          echo "→ deploy.sh wurde aktualisiert, starte neu"
          HD_DEPLOY_UPDATED=1 exec ./deploy.sh
        fi
      else
        echo "  unverändert"
      fi
    else
      echo "⚠ git pull in $REPO_DIR fehlgeschlagen, verwende die vorhandenen Deploy-Dateien"
    fi
  else
    echo "⚠ $REPO_DIR fehlt (siehe docs/BETRIEB.md, Abschnitt 3), Deploy-Dateien bleiben unverändert"
  fi
fi

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
