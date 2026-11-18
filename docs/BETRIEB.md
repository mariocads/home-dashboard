# Betrieb auf dem ThinkCentre

Dieses Runbook richtet das Home Dashboard einmalig auf dem ThinkCentre (Ubuntu) ein. Danach erreichst du es unter `https://home.fritz.box`.

## 1. Server vorbereiten (einmalig)

```bash
# Docker Engine + Compose-Plugin (offizielles Repo)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # danach neu anmelden

# Gemeinsames Proxy-Netz für alle Projekte
docker network create proxy

sudo mkdir -p /opt/stacks && sudo chown $USER /opt/stacks
```

## 2. Hostnamen in der FRITZ!Box setzen

1. In der FRITZ!Box unter **Heimnetz → Netzwerk → Netzwerkverbindungen** das ThinkCentre suchen und bearbeiten.
2. Als Gerätenamen `home` eintragen und **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** aktivieren.
3. Prüfen, z. B. vom Laptop aus: `ping home.fritz.box`
4. Achtung: Ab der ersten Passkey-Registrierung darf sich der Name **nicht mehr ändern**, sonst werden die Passkeys ungültig.
5. Das ThinkCentre muss im **Hauptnetz** hängen, nicht im Gastnetz.

## 3. Reverse Proxy (Caddy) starten

```bash
# Nur die Deploy-Dateien holen, nicht das ganze Repo
cd /opt/stacks
git clone --depth 1 --filter=blob:none --sparse https://github.com/mariocads/home-dashboard.git repo
cd repo && git sparse-checkout set deploy && cd ..
cp -r repo/deploy/infra /opt/stacks/infra
cp -r repo/deploy/home-dashboard /opt/stacks/home-dashboard

cd /opt/stacks/infra && docker compose up -d
```

### Root-Zertifikat auf Handy und Laptop installieren (nötig für Passkeys)

```bash
docker compose -f /opt/stacks/infra/compose.yml cp \
  caddy:/data/caddy/pki/authorities/local/root.crt ~/home-root.crt
```

| Gerät   | Vorgehen                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone  | Datei per AirDrop oder Mail senden und öffnen → **Einstellungen → Profil geladen → Installieren**. Danach zusätzlich **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** öffnen und dort **vollständig vertrauen** aktivieren. |
| Android | **Einstellungen → Sicherheit → Verschlüsselung & Anmeldedaten → Zertifikat installieren → CA-Zertifikat**                                                                                                                                            |
| Windows | Datei doppelklicken → **Zertifikat installieren** → Speicherort **Lokaler Computer** → Speicher **Vertrauenswürdige Stammzertifizierungsstellen**                                                                                                    |
| macOS   | Datei in der Schlüsselbundverwaltung unter **System** importieren und **Immer vertrauen** setzen                                                                                                                                                     |

## 4. Home Dashboard starten

Die Images liegen in GHCR (`ghcr.io/mariocads/home-dashboard-web` und `-collector`). Sie werden bei jedem Push auf `main` neu gebaut.

**Einmalig nach dem ersten Release-Lauf:** Auf GitHub unter **Packages → Package settings** die Sichtbarkeit beider Packages auf **Public** stellen. Alternativ meldest du dich am Server einmal an: `docker login ghcr.io` mit einem PAT, der `read:packages` hat.

```bash
cd /opt/stacks/home-dashboard
cp .env.example .env
sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')|" .env
chmod 600 .env
chmod +x deploy.sh backup.sh
./deploy.sh
```

## 5. Ersten Passkey registrieren (Setup-Token)

```bash
cd /opt/stacks/home-dashboard
docker compose exec web node scripts/setup-token.ts
```

1. Der Befehl gibt einen Link `https://home.fritz.box/setup?token=…` aus. Er ist 30 Minuten gültig und funktioniert nur einmal.
2. Den Link am Handy öffnen, **Passkey anlegen** antippen und mit Face-ID bzw. Fingerabdruck bestätigen.
3. Die **10 Recovery-Codes** sicher aufbewahren, z. B. im Passwortmanager. Sie werden nur dieses eine Mal angezeigt.
4. Unter **Einstellungen** einen zweiten Passkey am Laptop hinzufügen.

**Notfall:** Wenn alle Passkeys und alle Recovery-Codes verloren sind, erzeugst du mit demselben Befehl einen neuen Setup-Link.

## 6. Updates und Rollback

```bash
cd /opt/stacks/home-dashboard
./deploy.sh                 # neuester Stand von main
./deploy.sh sha-1a2b3c4     # bestimmter Build bzw. Rollback
cat .deploy-history         # bisherige Deploys
```

Die Migrationen laufen beim Start des `web`-Containers automatisch und sind idempotent.

## 7. Backups

```bash
crontab -e
# 15 3 * * * /opt/stacks/home-dashboard/backup.sh >> /var/log/home-dashboard-backup.log 2>&1
```

**Restore-Test** (mindestens einmal pro Quartal):

```bash
docker compose exec -T db pg_restore -U homedash -d homedash --clean --if-exists < backups/<datei>.dump
```

## 8. Fehlersuche

| Symptom                                     | Prüfen                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `home.fritz.box` nicht erreichbar           | `docker compose -f /opt/stacks/infra/compose.yml logs caddy`, Gerätename in der FRITZ!Box |
| Zertifikatswarnung                          | Root-Zertifikat installiert? Unter iOS zusätzlich „vollständig vertrauen“ aktiviert?      |
| „Dieser Browser unterstützt keine Passkeys“ | Die Seite läuft nicht über vertrauenswürdiges HTTPS, siehe Root-Zertifikat                |
| web nicht healthy                           | `docker compose logs web`, `docker compose ps`                                            |
