// Anzeigeformate (Browser und Server), immer in Europe/Vienna.

const TZ = 'Europe/Vienna';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, ...opts });
const dayLong = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dayShort = fmt({ day: '2-digit', month: '2-digit' });
const dayFull = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const monthShort = fmt({ month: 'short' });
const weekdayShort = fmt({ weekday: 'short' });
const time = fmt({ hour: '2-digit', minute: '2-digit' });
const dateTime = fmt({ dateStyle: 'medium', timeStyle: 'short' });

export const kwhFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 });
export const kwFormat = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** kWh kompakt: ab 100 ohne Nachkommastelle (passt in Kacheln). */
export const formatKwh = (v: number) => (Math.abs(v) >= 100 ? intFormat : kwhFormat).format(v);
export const intFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 0 });

export type View = 'day' | 'week' | 'month' | 'year';

/** ISO-Kalenderwoche eines Tages (JJJJ-MM-TT). */
export function isoWeek(dateKey: string): number {
  const thursdayOf = (d: Date) => {
    const t = new Date(d);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
    return t;
  };
  const thursday = thursdayOf(new Date(`${dateKey}T00:00:00Z`));
  const firstThursday = thursdayOf(new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4)));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** Überschrift einer Periode, z. B. „Mi., 18. Nov. 2026“, „KW 47 · 16.11.–22.11.2026“, „November 2026“. */
export function periodLabel(view: View, startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const last = new Date(new Date(endIso).getTime() - 1);
  switch (view) {
    case 'day':
      return dayLong.format(start);
    case 'week':
      return `KW ${isoWeek(keyOf(start))} · ${dayShort.format(start)}–${dayFull.format(last)}`;
    case 'month':
      return monthYear.format(start);
    case 'year':
      return keyOf(start).slice(0, 4);
  }
}

/** Kalendertag (Wien) eines Zeitpunkts als JJJJ-MM-TT. */
export function keyOf(d: Date): string {
  const parts = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Beschriftung eines Balkens (Achse) und ausführliche Angabe (Detailzeile). */
export function bucketLabels(view: View, startIso: string): { axis: string; detail: string } {
  const start = new Date(startIso);
  switch (view) {
    case 'day':
      return { axis: time.format(start).slice(0, 2), detail: time.format(start) };
    case 'week':
      return { axis: weekdayShort.format(start).replace('.', ''), detail: dayLong.format(start) };
    case 'month':
      return { axis: String(Number(keyOf(start).slice(8))), detail: dayLong.format(start) };
    case 'year':
      return { axis: monthShort.format(start).replace('.', ''), detail: monthYear.format(start) };
  }
}

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatDay = (iso: string) => dayLong.format(new Date(iso));
export const formatMonth = (iso: string) => monthYear.format(new Date(iso));

export const eurFormat = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
/** Euro ohne Cent (Achsen, Kacheln ab 1.000 €) */
export const eurShortFormat = new Intl.NumberFormat('de-AT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
export const formatEur = (v: number) => (Math.abs(v) >= 1000 ? eurShortFormat : eurFormat).format(v);
/** Preise mit bis zu 4 Nachkommastellen (ct/kWh, Pauschalen) */
export const priceFormat = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export const pctFormat = new Intl.NumberFormat('de-AT', {
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
});

/** Kalendertag JJJJ-MM-TT als „17.03.2026“ */
export const formatDateKey = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;
/** Monat JJJJ-MM als „03/2026“ */
export const formatMonthKey = (key: string) => `${key.slice(5, 7)}/${key.slice(0, 4)}`;
