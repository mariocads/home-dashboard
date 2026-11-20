// Auswertungen der Wärmepumpe: Verläufe und Tageswerte aus den ISG-Zählern.

export interface TimedValue {
  ts: Date;
  value: number;
}

/** Punkt einer Linie; v = null unterbricht die Linie (keine Daten). */
export interface LinePoint {
  t: number;
  v: number | null;
}

/**
 * Mittelwerte je Zeitschritt im Bereich [from, to). Schritte ohne Werte ergeben null.
 * Zeitstempel ist der Beginn des Schritts.
 */
export function bucketAverage(
  points: readonly TimedValue[],
  from: Date,
  to: Date,
  stepMs: number,
): LinePoint[] {
  const start = from.getTime();
  const n = Math.max(0, Math.ceil((to.getTime() - start) / stepMs));
  const sum = new Array<number>(n).fill(0);
  const count = new Array<number>(n).fill(0);
  for (const p of points) {
    const i = Math.floor((p.ts.getTime() - start) / stepMs);
    if (i < 0 || i >= n) continue;
    sum[i]! += p.value;
    count[i]! += 1;
  }
  return sum.map((s, i) => ({
    t: start + i * stepMs,
    v: count[i] ? Math.round((s / count[i]!) * 100) / 100 : null,
  }));
}

/**
 * Zunahme eines Summenzählers in einem Zeitraum: letzter Stand im Zeitraum minus letzter Stand davor.
 * Fehlt ein Stand davor (Beginn der Aufzeichnung), zählt der erste Stand im Zeitraum.
 * Ein Rückgang (Zählertausch, Fehlwert) ergibt null.
 */
export function counterIncrease(
  before: TimedValue | null,
  firstInside: TimedValue | null,
  lastInside: TimedValue | null,
): number | null {
  const base = before ?? firstInside;
  if (!base || !lastInside) return null;
  const diff = lastInside.value - base.value;
  return diff < 0 ? null : Math.round(diff * 1000) / 1000;
}

/**
 * Arbeitszahl (Wärme ÷ Strom). Die Zähler der ISG zählen in ganzen kWh; unter minPowerKwh ist der
 * Rundungsfehler zu groß, dann null.
 */
export function workRatio(heatKwh: number | null, powerKwh: number | null, minPowerKwh = 3): number | null {
  if (heatKwh === null || powerKwh === null || powerKwh < minPowerKwh) return null;
  return Math.round((heatKwh / powerKwh) * 100) / 100;
}
