/**
 * Legt für E2E-Tests eine erfundene Lade-Aufstellung (Q3 2026, Status „prüfen“) und einen
 * eingerichteten Mailversand an. Keine echten Ladungen, Adressen oder Seriennummern.
 */
import { createHash } from 'node:crypto';
import { createDb, requestChargeReport, runMigrations, saveAdapterStatus, saveChargeExport } from '@hd/db';

const CSV = [
  '"Session Number";"Session Identifier";"ID Chip";"ID Chip UID";"ID Chip Name";"Start";"Ende";"Dauer gesamt";"Dauer aktiver Stromfluss";"max. Leistung [kW]";"max. Strom [A]";"Energie [kWh]";"Energie PV [kWh]";"Energie Akku [kWh]";"Zaehlerstand Differenz [kWh]";"Zaehlerstand Anfang [kWh]";"Zaehlerstand Ende [kWh]";"WLAN-Verbindung"',
  '"1";"000000_1";"";"";"";"02.07.2026 19:00:00";"03.07.2026 06:00:00";"11:00:00";"02:00:00";"11";"16";"20,5";"";"";"20,5";"1000";"1020,5";"TESTNETZ"',
  '"2";"000000_2";"";"";"";"15.08.2026 18:30:00";"16.08.2026 07:15:30";"12:45:30";"03:00:00";"11";"16";"30,25";"";"";"30,25";"1020,5";"1050,75";"TESTNETZ"',
].join('\r\n');

const handle = createDb(process.env.DATABASE_URL ?? 'pglite://.pglite/e2e');
try {
  await runMigrations(handle);
  const now = new Date();
  await requestChargeReport(handle.db, '2026-Q3', now);
  await saveChargeExport(
    handle.db,
    '2026-Q3',
    {
      csv: CSV,
      csvSha256: createHash('sha256').update(CSV).digest('hex'),
      sessionCount: 2,
      energyKwh: 50.75,
    },
    now,
  );
  // Mailversand „eingerichtet“; Zeitpunkt in der Zukunft, damit der Status während des Tests nicht veraltet
  await saveAdapterStatus(
    handle.db,
    {
      name: 'mail',
      target: 'absender@example.test über smtp.example.test:465',
      lastSuccessAt: now,
      lastError: null,
    },
    new Date(now.getTime() + 3_600_000),
  );
} finally {
  await handle.close();
}
