# Home Dashboard

Ein selbst gehostetes Dashboard für ein Zweiparteienhaus. Es erfasst die Energiedaten zentral (Smartmeter, Wärmepumpe, Wallbox, Wärme- und Kältezähler), macht Kosten transparent und teilt sie monatlich zwischen den Parteien auf.

- **Nur im Heimnetz** unter `https://home.fritz.box` erreichbar, Login per **Passkey**
- **Mobile first** als PWA mit Dark Mode
- **TypeScript Full-Stack:** SvelteKit 3, Node 24, PostgreSQL/TimescaleDB, Drizzle ORM
- **Tests:** Vitest, property-based Tests mit fast-check, Playwright im Mobile-Viewport

Gesamtplan und Phasen stehen in [docs/PROJEKTPLAN.md](docs/PROJEKTPLAN.md), der Betrieb ist in [docs/BETRIEB.md](docs/BETRIEB.md) beschrieben.

## Struktur

```
apps/web          SvelteKit: UI, API, Passkey-Login
apps/collector    Node-Dienst, der Daten aus den Geräten liest (nur lesend)
packages/domain   Reine Rechenlogik (Kosten, Aufteilung) – property-based getestet
packages/db       Drizzle-Schema, Migrationen, Treiber für Postgres und PGlite
deploy/           Docker Compose (infra mit Caddy, home-dashboard), deploy.sh, backup.sh
```

## Entwicklung

Voraussetzung: Node 24 und pnpm 9. Docker ist **nicht** nötig, weil lokal PGlite (eingebettetes Postgres) läuft.

```bash
pnpm install
pnpm dev                                   # http://localhost:5173
pnpm --filter @hd/web setup-token          # Einrichtungslink für den ersten Passkey
```

| Befehl                             | Zweck                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm test` / `pnpm test:coverage` | Unit- und Integrationstests (PGlite)                                                                              |
| `pnpm test:e2e`                    | Playwright (Build vorher: `pnpm --filter @hd/web build`). Mit `PW_CHANNEL=msedge` läuft er im installierten Edge. |
| `pnpm lint` / `pnpm format`        | ESLint und Prettier                                                                                               |
| `pnpm typecheck`                   | `tsc` und `svelte-check`                                                                                          |
| `pnpm db:generate`                 | Migration aus Schemaänderungen erzeugen                                                                           |

## Private Daten

Das Repository ist öffentlich. Für private Daten gilt deshalb:

- **`prep/`** enthält Smartmeter-Schlüssel, Zählpunkt, Adresse und Rohdaten. Der Ordner ist per `.gitignore` ausgeschlossen, an jeder Stelle im Baum.
- `scripts/guard-private-files.mjs` läuft als Pre-Commit-Hook und in der CI. Er blockiert `prep/`, `.env`-Dateien, NetzOÖ-Rohexporte und Zählpunktnummern.
- gitleaks prüft in der CI auf Secrets.
- Echte Messdaten kommen nie ins Repo. Test-Fixtures sind synthetisch.
