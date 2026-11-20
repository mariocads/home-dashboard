/**
 * Legt für E2E-Tests erfundene Werte der Wärmepumpe für den heutigen Tag an (alle 5 Minuten bis jetzt).
 * Keine echten Messwerte; nur Aufbau und Größenordnung entsprechen einer Anlage.
 */
import { createDb, ensureMeter, insertReadings, type NewReading, runMigrations } from '@hd/db';
import { periodFor, viennaDateKey, WP_METER, WP_QUANTITY as Q } from '@hd/domain';

const handle = createDb(process.env.DATABASE_URL ?? 'pglite://.pglite/e2e');
try {
  await runMigrations(handle);
  const id = await ensureMeter(handle.db, WP_METER);
  const now = Date.now();
  const start = periodFor('day', viennaDateKey(new Date(now))).start.getTime();
  const rows: NewReading[] = [];
  const add = (quantity: string, ts: number, value: number) =>
    rows.push({ quantity, ts: new Date(ts), value: Math.round(value * 100) / 100 });

  // Stände kurz vor Mitternacht
  const before = start - 5 * 60_000;
  add(Q.heatHeatingKwh, before, 1000);
  add(Q.heatDhwKwh, before, 200);
  add(Q.powerHeatingKwh, before, 300);
  add(Q.powerDhwKwh, before, 60);

  for (let ts = start, i = 0; ts <= now; ts += 5 * 60_000, i++) {
    const h = i / 12;
    const on = Math.floor(h * 2) % 3 !== 0; // läuft zwei von drei halben Stunden
    add(Q.outdoorC, ts, 2 + 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI));
    add(Q.flowC, ts, on ? 34 + Math.sin(h) : 29);
    add(Q.returnC, ts, on ? 29 + Math.sin(h) * 0.5 : 28);
    add(Q.inverterW, ts, on ? 1400 + 300 * Math.sin(h * 1.7) : 0);
    add(Q.heatHeatingKwh, ts, 1000 + Math.floor(h * 3.5));
    add(Q.heatDhwKwh, ts, 200 + Math.floor(h * 0.5));
    add(Q.powerHeatingKwh, ts, 300 + Math.floor(h * 0.9));
    add(Q.powerDhwKwh, ts, 60 + Math.floor(h * 0.15));
  }
  // aktuelle Werte zum jetzigen Zeitpunkt, damit die Ansicht nicht „veraltet“ zeigt
  const last = now;
  add(Q.outdoorC, last, 3.5);
  add(Q.flowC, last, 34.2);
  add(Q.returnC, last, 29.1);
  add(Q.inverterW, last, 1500);
  for (const [q, v] of [
    [Q.dhwC, 48.5],
    [Q.dhwSetC, 48],
    [Q.hcC(1), 30.5],
    [Q.hcSetC(1), 31],
    [Q.hcC(2), 29],
    [Q.hcSetC(2), 29.5],
    [Q.bufferC, 30.5],
    [Q.bufferSetC, 31],
    [Q.roomC(4), 21.5],
    [Q.roomSetC(4), 21],
    [Q.roomHumidityPct(4), 48],
    [Q.hotGasC, 60],
    [Q.lowPressureBar, 7],
    [Q.midPressureBar, 10],
    [Q.highPressureBar, 19],
    [Q.flowRateLpm, 25],
    [Q.compressorStarts, 1234],
    [Q.runtimeHeatingH, 4321],
    [Q.runtimeDhwH, 432],
    [Q.efficiencyHeating12m, 3.5],
    [Q.efficiencyDhw12m, 3.2],
  ] as const) {
    add(q, last, v);
  }
  await insertReadings(handle.db, id, 'isg', rows);
} finally {
  await handle.close();
}
