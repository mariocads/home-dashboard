# Betrieb auf dem Server

Dieses Runbook richtet das Home Dashboard einmalig auf einem Server im Heimnetz ein. Danach erreichst du es unter `https://home-server.fritz.box`. Zielsystem ist der ThinkCentre (Ubuntu). Bis er da ist, läuft alles gleich auf einem Raspberry Pi (Raspberry Pi OS Lite 64-bit). Die Images gibt es für beide Architekturen, die Schritte sind identisch. Für den Pi gibt es eine Ergänzung (Abschnitt 1a), für den Wechsel einen eigenen Abschnitt [Umzug auf einen neuen Server](#8-umzug-auf-einen-neuen-server).

## 1. Server vorbereiten (einmalig)

```bash
# Docker Engine + Compose-Plugin (offizielles Repo)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # danach neu anmelden

# Gemeinsames Proxy-Netz für alle Projekte
docker network create proxy

sudo mkdir -p /opt/stacks && sudo chown $USER /opt/stacks
```

## 1a. Ergänzung Raspberry Pi

Ein Pi 4 oder 5 mit mindestens 4 GB RAM reicht. Docker ist auf Raspberry Pi OS ebenfalls über `get.docker.com` installiert. Die übrigen Befehle aus Abschnitt 1 gelten unverändert.

```bash
uname -m                                   # muss aarch64 sein (64-bit), sonst passt das Image nicht
docker info 2>&1 | grep -i 'no memory limit' || echo "Speicherlimits OK"
```

- Meldet `docker info` **No memory limit support**, ans Ende der einzigen Zeile in `/boot/firmware/cmdline.txt` ` cgroup_enable=memory` anhängen und neu starten. Ohne diese Einstellung läuft alles, nur die Speicherlimits aus `compose.yml` greifen nicht.
- SD-Karten vertragen dauernde Schreibzugriffe schlecht. Besser ist ein Start von einer USB-SSD. Auf jeden Fall die Backups regelmäßig vom Pi wegkopieren (siehe Abschnitt 7), denn ein Dump auf derselben Karte hilft bei einem Kartendefekt nicht.

## 2. Hostnamen in der FRITZ!Box setzen

1. In der FRITZ!Box unter **Heimnetz → Netzwerk → Netzwerkverbindungen** den Server (Pi oder ThinkCentre) suchen und bearbeiten.
2. Als Gerätenamen `home-server` eintragen und **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** aktivieren.
3. Prüfen, z. B. vom Laptop aus: `ping home-server.fritz.box`
4. Achtung: Ab der ersten Passkey-Registrierung darf sich der Name `home-server.fritz.box` **nicht mehr ändern**, sonst werden die Passkeys ungültig. Beim Umzug wandert der Name deshalb vom alten auf den neuen Server (Abschnitt 8).
5. Der Server muss im **Hauptnetz** hängen, nicht im Gastnetz.

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
chmod +x deploy.sh backup.sh restore.sh
./deploy.sh

# TimescaleDB-Version festhalten, damit ein späterer Server dieselbe Version bekommt (nötig für den Restore)
v=$(docker compose exec -T db psql -U homedash -d homedash -Atc "select extversion from pg_extension where extname='timescaledb'")
echo "TIMESCALE_TAG=${v}-pg16" >> .env && ./deploy.sh
```

## 5. Ersten Passkey registrieren (Setup-Token)

```bash
cd /opt/stacks/home-dashboard
docker compose exec web node scripts/setup-token.ts
```

1. Der Befehl gibt einen Link `https://home-server.fritz.box/setup?token=…` aus. Er ist 30 Minuten gültig und funktioniert nur einmal.
2. Den Link am Handy öffnen, **Passkey anlegen** antippen und mit Face-ID bzw. Fingerabdruck bestätigen.
3. Die **10 Recovery-Codes** sicher aufbewahren, z. B. im Passwortmanager. Sie werden nur dieses eine Mal angezeigt.
4. Unter **Einstellungen** einen zweiten Passkey am Laptop hinzufügen.

**Notfall:** Wenn alle Passkeys und alle Recovery-Codes verloren sind, erzeugst du mit demselben Befehl einen neuen Setup-Link.

### Verbrauchsdaten: AMIS-Leser und NetzOÖ-Export

Laufend kommen die Daten vom AMIS-Leser. Der Collector speichert jede Minute den Zählerstand und leitet daraus nach jeder abgeschlossenen Viertelstunde den Verbrauch ab. Nach einem Update oder Ausfall holt er fehlende Viertelstunden aus den vorhandenen Zählerständen selbst nach.

Der NetzOÖ-Export ist für die Zeit **vor** dem AMIS-Leser (Historie) und für Lücken, z. B. wenn der Leser ausgefallen war. Für dieselbe Viertelstunde gilt immer der NetzOÖ-Wert, auch wenn er gleich ist; die Vorschau zeigt dazu „davon AMIS-Werte“. Der AMIS-Leser überschreibt NetzOÖ-Werte nie.

1. Im NetzOÖ-Smartmeter-Portal die Viertelstundenwerte des gewünschten Zeitraums als CSV exportieren. Lange Zeiträume dürfen auf mehrere Dateien verteilt sein.
2. In der App unter **Strom → NetzOÖ-Export importieren** die Datei wählen, **Prüfen** und dann **Importieren**.
3. Ein erneuter Import desselben Zeitraums ist unschädlich: Vorhandene Werte werden erkannt, nachträglich korrigierte überschrieben.

Die Exportdatei enthält den Zählpunkt im Namen. Sie wird nur gelesen, nicht gespeichert.

### Wärmepumpe: Stiebel ISG

Der Collector liest die Wärmepumpe über die ISG per Modbus TCP (Port 502), standardmäßig jede Minute. Er liest nur und kann an der Anlage nichts verstellen. Welche Werte er liest, steht in [WAERMEPUMPE.md](WAERMEPUMPE.md).

1. In der FRITZ!Box der ISG eine feste IP geben (**Heimnetz → Netzwerk → Gerät bearbeiten → Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen**).
2. Vom Server prüfen, ob Modbus erreichbar ist:
   ```bash
   timeout 3 bash -c '</dev/tcp/<IP der ISG>/502' && echo "Modbus-Port offen"
   ```
3. In `/opt/stacks/home-dashboard/.env` `ISG_HOST=<IP der ISG>` eintragen und `./deploy.sh` ausführen. Ohne Eintrag fragt der Collector `servicewelt.fritz.box` ab; `ISG_HOST=` (leer) schaltet den Adapter ab.
4. In der App unter **Einstellungen → Wärmepumpe (ISG)** muss nach spätestens einer Minute „Online“ stehen.

### Tarife übernehmen

Preise, Teilzahlungen und Rechnungen liegen nur in der Datenbank und in einer lokalen JSON-Datei (z. B. `prep/seed/tarife.json`), nie im Repo.

1. In der App unter **Kosten → Tarife verwalten → Tarifdatei** die JSON-Datei wählen und **Übernehmen**. Einträge mit gleichem Empfänger, gleicher Bezeichnung und gleichem Beginn werden überschrieben, andere bleiben.
2. Änderungen später direkt in der App vornehmen. **Sichern** lädt den aktuellen Stand als `tarife.json` herunter; die Datei außerhalb des Repos ablegen.
3. Neue Preise (z. B. Netzentgelte ab 1. Jänner) als neue Komponente mit eigenem **Gültig ab** anlegen und bei der alten **Gültig bis** setzen.

Format der Datei (alle Felder wie im Formular; Preis entweder `priceNet` oder `priceGross`, USt Standard 20 %):

```json
{
  "tariffs": [
    {
      "payee": "Lieferant",
      "category": "energie",
      "name": "Arbeitspreis",
      "unit": "ct_kwh",
      "priceGross": 12,
      "validFrom": "2026-01-01",
      "validTo": null,
      "window": { "months": [4, 5, 6, 7, 8, 9], "fromHour": 10, "toHour": 16 },
      "note": "optional"
    }
  ],
  "installments": [{ "payee": "Lieferant", "amountGross": 100, "fromMonth": "2026-04", "toMonth": null }],
  "invoices": [
    { "payee": "Lieferant", "fromDate": "2026-01-01", "toDate": "2026-12-31", "amountGross": 1200 }
  ]
}
```

`category` ist `energie`, `netz` oder `abgaben`; `unit` ist `ct_kwh`, `eur_year` oder `eur_month`. `window` gibt es nur für `ct_kwh` und ist optional.

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

Die Dumps liegen in `backups/`, also auf derselben Platte bzw. SD-Karte. Für einen Plattendefekt zusätzlich extern sichern: `RESTIC_REPOSITORY` in `.env` auf USB-Stick oder NAS setzen, oder die Dumps regelmäßig auf den Laptop holen:

```bash
scp '<user>@home-server.fritz.box:/opt/stacks/home-dashboard/backups/*.dump' .
```

**Restore** (Notfall oder Restore-Test, mindestens einmal pro Quartal). Die Datenbank wird dabei neu angelegt. `restore.sh` kümmert sich um die TimescaleDB-Besonderheiten:

```bash
cd /opt/stacks/home-dashboard
./backup.sh                                  # frischer Dump vom aktuellen Stand
./restore.sh backups/<datei>.dump            # Datenbank neu aus dem Dump
./deploy.sh
```

## 8. Umzug auf einen neuen Server

Zum Beispiel vom Raspberry Pi auf den ThinkCentre. Mitgenommen werden drei Dinge:

| Was                         | Warum                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Datenbank-Dump              | Messwerte, Tarife, Passkeys, Einstellungen                                                |
| `.env`                      | Datenbank-Passwort, Hostname, Adressen von AMIS-Leser und ISG, TimescaleDB-Version        |
| Caddy-Volume (`caddy_data`) | Die interne Zertifizierungsstelle: Das Root-Zertifikat auf Handy und Laptop bleibt gültig |

Weil der Hostname `home-server.fritz.box` gleich bleibt, funktionieren die Passkeys weiter. Die Images holt der neue Server selbst passend zu seiner Architektur aus GHCR. Der Umzug dauert etwa 15 Minuten. In dieser Zeit fehlen die Live-Werte des AMIS-Lesers; die Viertelstundenwerte lassen sich später aus dem NetzOÖ-Export nachladen.

**1. Neuen Server vorbereiten:** Abschnitt 1 ausführen und aus Abschnitt 3 die Dateien holen (`git clone …` bis `cp -r …`). Noch **nichts starten**.

**2. Alten Server anhalten und sichern:**

```bash
cd /opt/stacks/home-dashboard
docker compose stop collector web            # ab hier keine neuen Werte mehr
./backup.sh
dump=$(ls -t backups/homedash-*.dump | head -1)
docker run --rm -v infra_caddy_data:/data -v "$PWD":/out alpine tar czf /out/caddy_data.tgz -C /data .
scp .env caddy_data.tgz "$dump" <user>@<IP des neuen Servers>:/opt/stacks/home-dashboard/
```

**3. Auf dem neuen Server einspielen und starten:**

```bash
cd /opt/stacks/infra
docker compose up --no-start                 # legt Container und Volume an
docker run --rm -v infra_caddy_data:/data -v /opt/stacks/home-dashboard:/in alpine tar xzf /in/caddy_data.tgz -C /data
docker compose up -d

cd /opt/stacks/home-dashboard
chmod 600 .env && chmod +x deploy.sh backup.sh restore.sh
./restore.sh homedash-*.dump
./deploy.sh
rm caddy_data.tgz                            # enthält den privaten Schlüssel der Zertifizierungsstelle
```

**4. Namen in der FRITZ!Box umhängen** (unter **Heimnetz → Netzwerk → Netzwerkverbindungen**):

1. Den alten Server umbenennen, z. B. in `pi`. Hat er im Betriebssystem ebenfalls den Hostnamen `home-server`, dort auch umbenennen (`sudo hostnamectl set-hostname pi`, dann neu starten), damit er sich den Namen nicht zurückholt.
2. Der neue Server taucht mit demselben Hostnamen meist als `home-server-2` o. ä. auf. Ihn in `home-server` umbenennen und **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** aktivieren.
3. Vom Laptop prüfen, dass `ping home-server.fritz.box` die neue IP zeigt. Unter Windows hilft bei Bedarf `ipconfig /flushdns`, am Handy kurz das WLAN aus- und einschalten.
4. `https://home-server.fritz.box` öffnen: keine Zertifikatswarnung, Anmeldung mit Passkey, Daten bis zum Umzug vorhanden, Kachel „Leistung jetzt“ aktuell.

**5. Alten Server stilllegen:** In `/opt/stacks/home-dashboard` und `/opt/stacks/infra` jeweils `docker compose down` ausführen. Die Volumes bleiben als Rückfallebene erhalten. Falls etwas schiefgeht: Namen in der FRITZ!Box zurückhängen und auf dem alten Server `docker compose up -d` (erst infra, dann home-dashboard).

## 9. Fehlersuche

| Symptom                                      | Prüfen                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `home-server.fritz.box` nicht erreichbar     | `docker compose -f /opt/stacks/infra/compose.yml logs caddy`, Gerätename in der FRITZ!Box       |
| Zertifikatswarnung                           | Root-Zertifikat installiert? Unter iOS zusätzlich „vollständig vertrauen“ aktiviert?            |
| „Dieser Browser unterstützt keine Passkeys“  | Die Seite läuft nicht über vertrauenswürdiges HTTPS, siehe Root-Zertifikat                      |
| web nicht healthy                            | `docker compose logs web`, `docker compose ps`                                                  |
| Kachel „Leistung jetzt“ zeigt „veraltet“     | **Einstellungen → AMIS-Leser** zeigt Zustand und Ursache; sonst `docker compose logs collector` |
| collector meldet `ENOTFOUND` beim AMIS-Leser | Name löst im Container nicht auf: in `.env` `AMIS_URL=http://<feste IP>/rest` setzen            |
| Wärmepumpe „Offline“ mit `ECONNREFUSED`      | Modbus TCP an der ISG nicht aktiv; in der SERVICEWELT unter **Diagnose → System → ISG** prüfen  |
| Wärmepumpe „Offline“ mit `ENOTFOUND`         | in `.env` `ISG_HOST=<feste IP>` setzen                                                          |
