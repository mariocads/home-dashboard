# Projektplan Home-Dashboard

Stand: 18.11.2026 · Grundlage: `prep/Ausgangslage.MD` und Interview

## 1. Ziel und Rahmen

Eine zentrale Datenerfassung für das Zweiparteienhaus soll Strom, Wärmepumpe, Wallbox und Heizung zusammenführen. Darauf bauen Kostenoptimierung, Überwachung und der monatliche Kostensplit zwischen den Parteien auf.

| Thema                | Entscheidung                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Architektur          | Eigene Web-App und eigene Zeitreihen-DB. Die Geräte werden über bewährte Collector-Tools angebunden (MQTT, Modbus, wmbusmeters). |
| Tech-Stack           | TypeScript Full-Stack: SvelteKit (UI und API) und ein Node-Collector-Dienst in einem pnpm-Monorepo                               |
| Datenbank            | PostgreSQL 16 mit TimescaleDB (Hypertables, Continuous Aggregates, Kompression)                                                  |
| Zugriff              | Nur im Heimnetz unter `https://home.fritz.box` (FRITZ!Box-Hostname des ThinkCentre). Keine Portfreigabe.                         |
| Benutzer             | Ein Admin-Account (Partei A). Partei B bekommt nur die PDF-Abrechnung, keinen Login.                                             |
| Login                | Passkey (WebAuthn), dazu Recovery-Codes als Notfallzugang                                                                        |
| Steuerung            | Nur lesen. Das Dashboard schaltet keine Geräte.                                                                                  |
| Stromkosten          | Rechnungsgenau: Energiepreis, Grundpauschale, Netzentgelte NetzOÖ, Abgaben und USt, jeweils mit Gültigkeitszeiträumen            |
| Haushaltsstrom-Split | Fixer, einstellbarer Schlüssel                                                                                                   |
| WP-Strom-Split       | Nach den Techem-Wärme- und Kältemengen je Partei                                                                                 |
| Abrechnung           | PDF pro Monat für Partei B, archiviert                                                                                           |
| Tests                | Vitest, property-based Tests mit fast-check, Integrationstests mit Testcontainers, Playwright-E2E im Mobile-Viewport             |
| Repo                 | GitHub, öffentlich. Keine Secrets und keine personenbezogenen Daten im Code.                                                     |
| Hosting              | ThinkCentre M70q Gen5 mit Ubuntu, Docker Compose, gekapselt neben anderen Projekten                                              |
| CI/CD                | GitHub Actions bauen Images und legen sie in GHCR ab. Auf dem Server wird per Pull-Skript deployt, ohne self-hosted Runner.      |
| PV / Speicher        | Nicht vorhanden und nicht geplant                                                                                                |

## 2. Systemarchitektur

```
                         Heimnetz (FRITZ!Box, Hauptnetz – nicht Gastnetz)
 ┌──────────────┐  MQTT   ┌─────────────────────────── ThinkCentre (Docker) ───────────────────────────┐
 │ AMIS-Leser   │────────▶│  mosquitto ──▶ collector ──▶ timescaledb ◀── web (SvelteKit) ◀── caddy ◀──│── Handy/Laptop
 │ (Smartmeter) │         │      ▲            ▲   ▲                         (UI, API, PDF)    (TLS)    │   https://home.fritz.box
 └──────────────┘         │      │            │   │                                                   │
 ┌──────────────┐  HTTP   │      │            │   └── Modbus TCP ── Stiebel ISG (WPM)                 │
 │ go-e Gemini  │─────────┼──────┼────────────┘                                                       │
 └──────────────┘         │  wmbusmeters ◀── USB-wM-Bus-Stick ◀── Funk ── 4× Techem Vario 4           │
                          │  (später: Loxone Miniserver, Rehau)                                       │
 NetzOÖ-Portal ──CSV──────┼──▶ Upload in web ──▶ timescaledb                                          │
                          └───────────────────────────────────────────────────────────────────────────┘
```

### Monorepo-Struktur

```
home-dashboard/
├─ apps/
│  ├─ web/            SvelteKit (adapter-node): UI, API-Routen, Auth, PDF-Erzeugung
│  └─ collector/      Node-Dienst: ein Adapter pro Quelle, schreibt Messwerte in die DB
├─ packages/
│  ├─ domain/         Reine Logik ohne I/O: Tarife, Kostenberechnung, Split, Aggregation, Zeitzonen
│  ├─ db/             Drizzle-ORM-Schema, Migrationen, Repositories
│  └─ parsers/        NetzOÖ-CSV, AMIS-Payload, wmbusmeters-JSON, ISG-Register
├─ deploy/            compose.yml, Caddyfile-Snippet, deploy.sh, backup.sh
├─ docs/              Plan, Architekturentscheidungen (ADRs), Gerätenotizen
└─ .github/workflows/ ci.yml, release.yml
```

`packages/domain` ist das Herz des Projekts. Dort liegt die gesamte Rechenlogik als reine Funktionen. Deshalb lässt sie sich vollständig property-based testen.

### Datenmodell (Kern)

- `meter`: Messstelle (Hauptzähler, Wallbox, WP, Wärmezähler Partei A, Kältezähler Partei A, …) mit Typ, Einheit, Partei und Quelle
- `reading` (Hypertable): `ts` (UTC), `meter_id`, `quantity` (energy_import, power, heat, cold, …), `value`, `source`. Bei Duplikaten entscheidet die Priorität der Quelle.
- Continuous Aggregates: 15 min, Stunde, Tag und Monat je Zähler
- `tariff_component`: Lieferant, Netz oder Abgabe; Typ (ct/kWh, €/Monat, €/Jahr); Betrag; USt; `valid_from`/`valid_to`
- `invoice`: erfasste Monatsrechnungen für den Abgleich Rechnung gegen Berechnung
- `party` und `allocation_rule`: Parteien und Split-Schlüssel mit Gültigkeitszeitraum
- `bill`: erzeugte Abrechnungen samt PDF und eingefrorenen Eingangswerten (reproduzierbar)

Alle Zeitstempel werden in UTC gespeichert und in `Europe/Vienna` angezeigt. Die Sommerzeit-Umstellung (Tage mit 92 bzw. 100 Viertelstunden) ist ein eigener Testfall.

## 3. Sicherheit und Datenschutz (öffentliches Repo)

- **`prep/` nicht einchecken.** Die Datei enthält den Smartmeter-Schlüssel, den Zählpunkt und die Adresse. `.gitignore` ist bereits angelegt.
- Alle Geheimnisse und Geräteadressen stehen nur in `deploy/.env` auf dem Server. Im Repo liegt nur `.env.example` mit Platzhaltern.
- Im Code heißen die Parteien neutral „Partei A/B“. Die echten Namen stehen nur in der DB-Konfiguration.
- gitleaks als Pre-Commit-Hook und in der CI. Zusätzlich GitHub Secret Scanning und Dependabot bzw. Renovate.
- Caddy lauscht nur im LAN. Es gibt keine Portfreigabe auf der FRITZ!Box.
- Passkey-Login über SimpleWebAuthn mit `rpID = home.fritz.box`:
  - Die erste Registrierung läuft über ein einmaliges Setup-Token, das per CLI am Server erzeugt wird.
  - Zwei Passkeys registrieren (Handy und Laptop) und zehn Recovery-Codes ausgeben.
  - WebAuthn braucht ein vertrauenswürdiges HTTPS. Deshalb wird die Root-CA von Caddy (`tls internal`) einmalig am Handy installiert. Unter iOS muss sie zusätzlich unter Einstellungen → Info → Zertifikatsvertrauen aktiviert werden.
  - Den Hostnamen später nicht mehr ändern, sonst werden die Passkeys ungültig.
- Sessions: HttpOnly- und Secure-Cookies mit SameSite=Strict, Rate-Limit am Login, Security-Header (CSP) über Caddy

## 4. Kapselung auf dem ThinkCentre

- Ein **eigenes Compose-Projekt `infra`** enthält nur Caddy als gemeinsamen Reverse Proxy für alle Projekte, mit dem externen Docker-Netzwerk `proxy`.
- Das **Compose-Projekt `home-dashboard`** (`/opt/stacks/home-dashboard`) umfasst `web`, `collector`, `timescaledb`, `mosquitto` und später `wmbusmeters`.
  - Ein internes Netzwerk ist nur für die DB und den Broker da. Nur `web` hängt zusätzlich am Netzwerk `proxy`.
  - Jeder Container hat CPU- und RAM-Limits, Restart-Policy, Healthchecks und Volumes mit klarem Namen.
- Updates: `deploy.sh` holt das gewünschte Image-Tag aus GHCR, führt die Migrationen aus, startet `docker compose up -d` und prüft den Healthcheck. Rollback heißt: das vorherige Tag deployen.
- Backup: nächtlich `pg_dump` plus `restic` auf ein externes Ziel (USB-Platte oder NAS). Ein Restore-Test steht als Checkliste in den Docs.
- Platz: 256 GB reichen. Rohdaten werden nach 7 Tagen komprimiert, Live-Sekundenwerte nach 90 Tagen auf Minutenwerte verdichtet. Die Aggregate bleiben dauerhaft.
- Hinweis: Ein M70q Gen5 hat eine Intel-CPU der 13./14. Generation. Die Angabe „i7-4700“ ist vermutlich ein Tippfehler, für den Plan spielt das keine Rolle.

## 5. Teststrategie

| Ebene                   | Werkzeug                                                   | Inhalt                                                                            |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Unit und property-based | Vitest, fast-check                                         | `domain` und `parsers`, Coverage-Ziel ≥ 95 %                                      |
| Integration             | Vitest, Testcontainers (TimescaleDB, Mosquitto)            | Repositories, Aggregates, Collector-Adapter gegen aufgezeichnete Geräte-Payloads  |
| E2E                     | Playwright (Viewport iPhone/Pixel)                         | Login per virtuellem WebAuthn-Authenticator, CSV-Upload, Dashboards, PDF-Download |
| Statisch                | ESLint, `tsc --strict`, Prettier, gitleaks, Trivy (Images) | in jeder Pull Request                                                             |

Gesamt-Coverage mindestens 80 %. Die CI bricht ab, wenn ein Schwellenwert unterschritten wird.

**Invarianten für die property-based Tests (Auswahl):**

- Die Summe der Kostenanteile aller Parteien ergibt exakt die Gesamtkosten in Cent. Rundungsreste werden nach der Largest-Remainder-Methode verteilt.
- Kein Anteil ist negativ, und jeder Anteil ist ≤ Gesamt.
- Die Reihenfolge der Messwerte und der Parteien ändert das Ergebnis nicht (Permutationsinvarianz).
- Additivität: Kosten(Monat) = Σ Kosten(Tage) bzw. Kosten(Zeitraum A ∪ B) = Kosten(A) + Kosten(B), jeweils innerhalb der Rundungstoleranz.
- Ein Tarifwechsel (z. B. am 17.03.2026) wird tagesgenau richtig angewendet, für jeden zufälligen Stichtag.
- Der CSV-Parser übersteht beliebige Zeilenreihenfolgen, Duplikate, Lücken und Sommerzeit-Tage, und Parsen, Serialisieren und erneutes Parsen ist verlustfrei.
- Monotone Zählerstände ergeben keine negativen Verbräuche. Ein Zählertausch oder Reset wird erkannt.

## 6. Phasen und Meilensteine

### Phase 0: Fundament

> **Stand 18.11.2026:** Der Code ist fertig und lokal getestet (Unit, PGlite-Integration, Playwright-E2E). Offen sind der erste CI-Lauf auf GitHub und die Server-Einrichtung nach [BETRIEB.md](BETRIEB.md).

- Repo auf GitHub anlegen, pnpm-Monorepo, TypeScript strict, Lint, Prettier, Vitest, gitleaks-Hook
- GitHub Actions: Lint, Typecheck, Tests, Build, Push nach GHCR, Trivy
- Server: Docker einrichten, Compose-Projekt `infra` mit Caddy, Hostname `home` in der FRITZ!Box vergeben, Root-CA am Handy installieren
- Compose-Projekt `home-dashboard` mit TimescaleDB, erste Migration, Healthchecks, Backup-Skript
- Passkey-Login inklusive Setup-Token und Recovery-Codes
- Leere Mobile-first-PWA mit unterer Tab-Navigation (Übersicht · Strom · Kosten · Einstellungen), Dark Mode und Homescreen-Icon

**Ergebnis:** `https://home.fritz.box` ist erreichbar, der Login funktioniert, und die CI ist grün.

### Phase 1: MVP Strom (Release v0.1)

- NetzOÖ-CSV-Import (15-Minuten-Werte) per Upload in der App, mit Vorschau, Duplikat- und Lückenerkennung und Import-Protokoll
- Historie seit dem Einbau des Smartmeters importieren
- Tarifverwaltung: Gutmann DISK Strom bis 16.03.2026, E.ON ÖkoStrom Basis ab 17.03.2026, NetzOÖ-Netzentgelte, Abgaben und USt
- Kostenberechnung im `domain`-Paket. Ein Rechnungsabgleich zeigt erfasste Monatsrechnung gegen berechneten Wert mit Abweichung in %.
- Dashboards:
  - Übersicht: heute, aktueller Monat, Monatsprognose
  - Lastprofil mit Tag-, Woche-, Monat- und Jahr-Umschaltung
  - Grundlast (Nachtminimum)
  - Heatmap Wochentag × Uhrzeit
  - Vergleich zum Vormonat und Vorjahr
  - Kosten pro Monat nach Komponenten

**Ergebnis:** Vollständige Strom- und Kostentransparenz aus echten Daten, mit der Rechnung abgleichbar.

**Format des NetzOÖ-Exports** (gesichtet am 18.11.2026, Beispiel 25.03.–17.11.2026):

- UTF-8 mit BOM, Trennzeichen `;`, Dezimalkomma, Spalten `"Datum";"kWh";"kW";"Status";`
- `Datum` ist der lokale Beginn des 15-Minuten-Intervalls (`TT.MM.JJJJ HH:MM`), und es gilt kW = kWh × 4.
- Sommerzeit-Beginn: Der Tag hat 92 Zeilen, 02:00–02:45 fehlt.
- Winterzeit-Beginn: Der Tag hat 100 Zeilen, 02:00–02:45 kommt **zweimal** vor. Der erste Block ist MESZ, der zweite MEZ. Der Parser muss diese Mehrdeutigkeit über die Reihenfolge in der Datei auflösen.
- Im Beispiel kommt nur der Status `VALID` vor. Andere Werte (z. B. Ersatzwerte) werden gespeichert und markiert.
- Der Dateiname enthält den Zählpunkt. Er wird beim Import nicht übernommen, und echte Exporte kommen nie ins Repo. Test-Fixtures sind synthetisch.

### Phase 1b: AMIS-Leser live (sobald die Hardware da ist)

- AMIS-Leser bestellen und mit dem NetzOÖ-Schlüssel einrichten. Er kommt ins Haupt-WLAN, nicht ins Gastnetz.
- Mosquitto anbinden, der Collector-Adapter verarbeitet die Live-Leistung und die Zählerstände.
- Kachel mit der Live-Leistung (Aktualisierung über SSE)
- Zusammenführung mit den CSV-Daten: Je Zeitpunkt gewinnt die Quelle mit der höchsten Priorität. Der CSV-Import bleibt als Nachweis- und Korrekturquelle erhalten.

### Phase 2: Kostensplit und PDF-Abrechnung

Blockiert durch die offenen Punkte O1 bis O3.

- Die Techem-Zähler werden per wM-Bus-USB-Stick und `wmbusmeters` angebunden. Für den Typ 4.5.1 gibt es einen Treiber (`vario451`), für den Typ 4.1.3 ist das noch zu prüfen.
- Split-Modell, Gesamtbezug = Wallbox + Wärmepumpe + Rest:
  - Wallbox: 100 % Partei A (OG)
  - Wärmepumpe: nach dem Anteil an den Techem-Wärme- und Kältemengen. Die Kühlung entfällt komplett auf Partei A (OG), weil das EG keine Kühlung hat. Der Kellerraum hängt am Wärmezähler von Partei A.
  - Warmwasser: Regel offen (O2)
  - Rest-Haushaltsstrom: fixer Schlüssel
  - Fixkosten (Grundpauschale, Messentgelt): Schlüssel offen (O4)
- Monatsabrechnung als PDF mit Verbräuchen, Schlüsseln, Tarifen und Betrag. Die Abrechnung wird eingefroren und archiviert. Neu berechnet wird nur ausdrücklich.

### Phase 3: Wallbox und Wärmepumpe

- go-e Gemini Flex: lokale HTTP-API v2 in der go-e-App aktivieren, Ladevorgänge mit kWh und Kosten pro Ladung, Monatsstatistik
- Stiebel ISG über Modbus TCP: Vorlauf- und Rücklauftemperatur, Außentemperatur, Betriebsmodus, Verdichterstarts, Wärme- und Stromzähler (soweit vorhanden), Störmeldungen
- Effizienzkennzahlen: COP und JAZ aus WP-Strom und Wärmemenge, Abhängigkeit von der Außentemperatur

### Phase 4: Loxone und Rehau

- Zuerst Modelle und Schnittstellen klären (O5)
- Loxone Miniserver über die WebSocket-API mit einem eigenen Benutzer, der nur Leserechte hat
- Rehau: Raumtemperaturen, Sollwerte und Ventilstellungen je nach verfügbarer Schnittstelle (lokale API, Modbus oder KNX)
- Raumklima-Ansicht pro Geschoss

### Phase 5: Überwachung und Optimierung

- Alarme: Datenlücke oder ausgefallener Collector, ungewöhnliche Grundlast, WP-Störung, Takten der WP. Benachrichtigung per Push über ntfy (selbst gehostet).
- Optimierungshinweise: Grundlast-Treiber, Ladezeitpunkt, Heizkurve oder Sollwerte im Vergleich zum Verbrauch, Tarifvergleich bei Vertragsverlängerung
- Jahresauswertung pro Partei

## 7. Offene Punkte

| #      | Punkt                                                                                                                             | Blockiert | Wer          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------ |
| O1     | Woher kommt der WP-Stromverbrauch? (ISG-Verbrauchszähler über Modbus oder nachgerüsteter MID-/Modbus-Zähler im WP-Kreis)          | Phase 2   | Mario        |
| O2     | Wie wird Warmwasser aufgeteilt? (Fixer Schlüssel, Warmwasserzähler oder wie die Heizung)                                          | Phase 2   | Mario        |
| O3     | Schaltet der Installateur bzw. Techem den Funk der Techem-Zähler frei, und gibt es die AES-Schlüssel?                             | Phase 2   | Installateur |
| O4     | Wie werden die Fixkosten (Grundpauschale, Messentgelt, Leistungspauschale) aufgeteilt?                                            | Phase 2   | Mario        |
| O5     | Welche Modelle sind verbaut? (Loxone Miniserver Gen1/Gen2/Go, Rehau Nea Smart 1/2.0, Zusatzmodule)                                | Phase 4   | Mario        |
| O6     | Bedeutet „Erweiterung API 1.0“ an der ISG, dass Modbus TCP freigeschaltet ist? (Prüfen: ISG-Weboberfläche → Profil/Einstellungen) | Phase 3   | Mario        |
| ~~O7~~ | ~~Lädt nur Partei A an der Wallbox?~~ **Geklärt 18.11.2026: ja, nur Partei A.**                                                   | –         | –            |
| O8     | Liegt der Hostname `home.fritz.box` fest? Er bestimmt die Passkey-Domain.                                                         | Phase 0   | Mario        |

## 8. Einkaufsliste

- AMIS-Leser (mitterbaur.at), für Phase 1b
- Einen wM-Bus-USB-Stick (z. B. IMST iM871A oder Amber AMB8465-M) mit Funkreichweite zu den Techem-Zählern, für Phase 2
- Gegebenenfalls einen Zwischenzähler für den WP-Stromkreis (MID, Modbus), Einbau durch einen Elektriker, abhängig von O1

## 9. Nächste Schritte

1. Die offenen Punkte O7 und O8 bestätigen und den AMIS-Leser bestellen
2. Den Strom-Export der letzten Monate aus dem NetzOÖ-eService-Portal als Beispieldatei herunterladen. Sie wird zur Test-Fixture, anonymisiert und ohne Zählpunkt.
3. Mit Phase 0 starten: Repo, CI, Server-Grundsetup, Passkey-Login
