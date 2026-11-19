// Zeitzone Europe/Vienna (MEZ/MESZ) ohne externe Bibliothek.
// Regel der EU seit 1996: Sommerzeit vom letzten Sonntag im März 01:00 UTC
// bis zum letzten Sonntag im Oktober 01:00 UTC. Ein Test vergleicht mit Intl.

export const VIENNA = 'Europe/Vienna';

const HOUR = 3_600_000;

/** Letzter Sonntag eines Monats (1-basiert) um 01:00 UTC als Epoch-ms. */
function lastSundayAt1Utc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)); // Tag 0 des Folgemonats
  const back = lastDay.getUTCDay(); // 0 = Sonntag
  return Date.UTC(year, month - 1, lastDay.getUTCDate() - back, 1);
}

/** Abstand Wien zu UTC in Minuten (60 im Winter, 120 im Sommer). */
export function viennaOffsetMinutes(utc: Date): 60 | 120 {
  const t = utc.getTime();
  const year = utc.getUTCFullYear();
  return t >= lastSundayAt1Utc(year, 3) && t < lastSundayAt1Utc(year, 10) ? 120 : 60;
}

export interface LocalDateTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Alle UTC-Zeitpunkte, die der Wiener Ortszeit entsprechen:
 * 0 (Lücke bei Sommerzeit-Beginn), 1 (normal) oder 2 (doppelte Stunde bei Sommerzeit-Ende, früherer zuerst).
 */
export function viennaToUtcCandidates(l: LocalDateTime): Date[] {
  const naive = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  const result: Date[] = [];
  for (const offset of [120, 60] as const) {
    const candidate = new Date(naive - offset * 60_000);
    if (viennaOffsetMinutes(candidate) === offset) result.push(candidate);
  }
  return result;
}

export interface ViennaParts extends LocalDateTime {
  /** 0 = Montag … 6 = Sonntag */
  weekday: number;
}

/** Wiener Ortszeit-Bestandteile eines UTC-Zeitpunkts. */
export function toVienna(utc: Date): ViennaParts {
  const local = new Date(utc.getTime() + viennaOffsetMinutes(utc) * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: (local.getUTCDay() + 6) % 7,
  };
}

/** Lokaler Kalendertag als `JJJJ-MM-TT`. */
export function viennaDateKey(utc: Date): string {
  const p = toVienna(utc);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Beginn (00:00 Ortszeit) des Wiener Kalendertags. Mitternacht existiert in Wien immer genau einmal. */
export function startOfViennaDay(year: number, month: number, day: number): Date {
  return viennaToUtcCandidates({ year, month, day, hour: 0, minute: 0 })[0]!;
}

/** Länge eines Wiener Kalendertags in Stunden (23, 24 oder 25). */
export function viennaDayHours(year: number, month: number, day: number): number {
  const start = startOfViennaDay(year, month, day).getTime();
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = startOfViennaDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).getTime();
  return (end - start) / HOUR;
}
