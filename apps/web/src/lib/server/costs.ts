import {
  type Db,
  type InstallmentRow,
  type InvoiceRow,
  listInstallments,
  listInvoices,
  listTariffs,
  type TariffRow,
} from '@hd/db';
import {
  CATEGORY_LABELS,
  computeCosts,
  deviationPct,
  formatWindow,
  grossOf,
  INTERVAL_MS,
  type Installment,
  installmentsDue,
  type IntervalRow,
  parseWindow,
  type Period,
  periodFor,
  shiftPeriod,
  TARIFF_CATEGORIES,
  type TariffCategory,
  type TariffComponent,
  type TariffUnit,
  UNIT_LABELS,
  viennaDateKey,
} from '@hd/domain';
import { anchorDate, latestDataEnd, loadIntervals } from './energy.ts';

export function toComponent(r: TariffRow): TariffComponent {
  return {
    id: r.id,
    payee: r.payee,
    category: r.category as TariffCategory,
    name: r.name,
    unit: r.unit as TariffUnit,
    priceNet: r.priceNet,
    vatPct: r.vatPct,
    validFrom: r.validFrom,
    validTo: r.validTo,
    window: r.window ?? null,
    note: r.note,
  };
}

const toInstallment = (r: InstallmentRow): Installment => ({
  id: r.id,
  payee: r.payee,
  amountGross: r.amountGross,
  fromMonth: r.fromMonth,
  toMonth: r.toMonth,
});

const dayStart = (d: Date) => periodFor('day', viennaDateKey(d)).start;
const dayEnd = (d: Date) => periodFor('day', viennaDateKey(d)).end;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Kosten eines Monats für die Tage, an denen Messwerte vorliegen (vom ersten bis zum letzten Tag mit Daten),
 * damit Pauschalen nicht für Tage ohne Verbrauchswerte gezählt werden.
 */
function monthCosts(rows: IntervalRow[], components: TariffComponent[], m: Period) {
  const inMonth = rows.filter((r) => r.ts >= m.start && r.ts < m.end);
  if (inMonth.length === 0) return null;
  const from = new Date(Math.max(m.start.getTime(), dayStart(inMonth[0]!.ts).getTime()));
  const to = new Date(Math.min(m.end.getTime(), dayEnd(inMonth.at(-1)!.ts).getTime()));
  const result = computeCosts(inMonth, components, from, to);
  const expected = Math.round((m.end.getTime() - m.start.getTime()) / INTERVAL_MS);
  return { ...result, from, to, complete: inMonth.length >= expected };
}

const monthKeyOf = (p: Period) => p.key.slice(0, 7);

/** Beschreibung des Preises einer Komponente für die Anzeige. */
function describe(c: TariffComponent) {
  return {
    id: c.id!,
    payee: c.payee,
    category: c.category,
    name: c.name,
    unit: c.unit,
    unitLabel: UNIT_LABELS[c.unit],
    priceNet: c.priceNet,
    priceGross: grossOf(c.priceNet, c.vatPct),
    vatPct: c.vatPct,
    validFrom: c.validFrom,
    validTo: c.validTo,
    window: c.window,
    windowLabel: c.window ? formatWindow(c.window) : null,
    note: c.note ?? null,
  };
}

/** Alles für die Kostenseite: Monat mit Komponenten, Jahresverlauf, Teilzahlungen, Rechnungsabgleich. */
export async function loadCosts(db: Db, requestedMonth: string | null, now = new Date()) {
  const [dataEnd, tariffRows, installmentRows, invoiceRows] = await Promise.all([
    latestDataEnd(db),
    listTariffs(db),
    listInstallments(db),
    listInvoices(db),
  ]);
  const components = tariffRows.map(toComponent);
  const installments = installmentRows.map(toInstallment);
  const anchor = requestedMonth ? `${requestedMonth}-01` : anchorDate(null, dataEnd, now);
  const month = periodFor('month', anchor);
  const year = periodFor('year', anchor);
  const rows = components.length ? await loadIntervals(db, year.start, year.end) : [];

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = periodFor('month', `${year.key.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-01`);
    const cost = monthCosts(rows, components, m);
    return {
      key: monthKeyOf(m),
      start: m.start.toISOString(),
      cost,
      paid: installmentsDue(installments, monthKeyOf(m)),
    };
  });
  const selected = months[Number(month.key.slice(5, 7)) - 1]!;
  const cost = selected.cost;

  // Teilzahlungen gegen Berechnung: nur vollständige Monate, damit fehlende Tage den Saldo nicht verfälschen.
  const payees = [
    ...new Set([...installments.map((i) => i.payee), ...components.map((c) => c.payee)]),
  ].sort();
  const complete = months.filter((m) => m.cost?.complete);
  const balances = payees
    .map((payee) => {
      const relevant = complete.filter(
        (m) => (m.paid[payee] ?? 0) > 0 || (m.cost!.byPayee[payee] ?? 0) !== 0,
      );
      const paid = round2(relevant.reduce((s, m) => s + (m.paid[payee] ?? 0), 0));
      const computed = round2(relevant.reduce((s, m) => s + (m.cost!.byPayee[payee] ?? 0), 0));
      return { payee, months: relevant.length, paid, computed, balance: round2(paid - computed) };
    })
    .filter((b) => b.months > 0);

  const invoices = await Promise.all(invoiceRows.map((inv) => reconcileInvoice(db, components, inv)));

  const next = shiftPeriod(month, 1);
  return {
    month: { key: monthKeyOf(month), start: month.start.toISOString() },
    year: year.key.slice(0, 4),
    prevKey: monthKeyOf(shiftPeriod(month, -1)),
    nextKey: dataEnd && next.start < dataEnd ? monthKeyOf(next) : null,
    dataEnd: dataEnd?.toISOString() ?? null,
    hasTariffs: components.length > 0,
    selected: cost
      ? {
          from: cost.from.toISOString(),
          to: cost.to.toISOString(),
          complete: cost.complete,
          kwh: cost.kwh,
          net: cost.net,
          gross: cost.gross,
          ctPerKwh: cost.kwh > 0 ? round2((cost.gross / cost.kwh) * 100) : null,
          paid: round2(Object.values(selected.paid).reduce((s, v) => s + v, 0)),
          groups: TARIFF_CATEGORIES.map((category) => ({
            category,
            label: CATEGORY_LABELS[category],
            gross: cost.byCategory[category],
            lines: cost.lines
              .filter((l) => l.category === category)
              .map((l) => ({ ...l, component: describe(components[l.index]!) })),
          })).filter((g) => g.lines.length > 0),
        }
      : null,
    months: months.map((m) => ({
      key: m.key,
      start: m.start,
      gross: m.cost?.gross ?? null,
      complete: m.cost?.complete ?? false,
      paid: round2(Object.values(m.paid).reduce((s, v) => s + v, 0)),
    })),
    balances,
    invoices,
  };
}

async function reconcileInvoice(db: Db, components: TariffComponent[], inv: InvoiceRow) {
  const from = periodFor('day', inv.fromDate).start;
  const to = periodFor('day', inv.toDate).end;
  const rows = await loadIntervals(db, from, to);
  const expected = Math.round((to.getTime() - from.getTime()) / INTERVAL_MS);
  const computed = computeCosts(rows, components, from, to).byPayee[inv.payee] ?? 0;
  return {
    id: inv.id,
    payee: inv.payee,
    fromDate: inv.fromDate,
    toDate: inv.toDate,
    amountGross: inv.amountGross,
    note: inv.note,
    computed,
    /** Anteil der Viertelstunden mit Messwerten in % */
    coveragePct: Math.min(100, Math.round((rows.length / expected) * 100)),
    deviationPct: deviationPct(inv.amountGross, computed),
  };
}

/** Kachel der Übersicht: Kosten des Monats der jüngsten Daten. */
export async function loadCostTile(db: Db, now = new Date()) {
  const [dataEnd, tariffRows] = await Promise.all([latestDataEnd(db), listTariffs(db)]);
  if (!dataEnd || tariffRows.length === 0) return null;
  const month = periodFor('month', anchorDate(null, dataEnd, now));
  const rows = await loadIntervals(db, month.start, month.end);
  const cost = monthCosts(rows, tariffRows.map(toComponent), month);
  if (!cost) return null;
  return {
    monthKey: month.key,
    gross: cost.gross,
    ctPerKwh: cost.kwh > 0 ? round2((cost.gross / cost.kwh) * 100) : null,
    complete: cost.complete,
  };
}

/** Liste für die Tarifverwaltung. */
export async function loadTariffAdmin(db: Db) {
  const [tariffs, installments, invoices] = await Promise.all([
    listTariffs(db),
    listInstallments(db),
    listInvoices(db),
  ]);
  return {
    tariffs: tariffs.map((t) => describe(toComponent(t))),
    installments: installments.map((i) => ({ ...toInstallment(i), id: i.id })),
    invoices: invoices.map((i) => ({
      id: i.id,
      payee: i.payee,
      fromDate: i.fromDate,
      toDate: i.toDate,
      amountGross: i.amountGross,
      note: i.note,
    })),
  };
}

/** Export ohne IDs, im Format der Seed-Datei (für die lokale Sicherung außerhalb des Repos). */
export async function exportTariffData(db: Db) {
  const { tariffs, installments, invoices } = await loadTariffAdmin(db);
  return {
    tariffs: tariffs.map((t) => ({
      payee: t.payee,
      category: t.category,
      name: t.name,
      unit: t.unit,
      priceNet: t.priceNet,
      vatPct: t.vatPct,
      validFrom: t.validFrom,
      validTo: t.validTo,
      window: t.window,
      note: t.note,
    })),
    installments: installments.map(({ payee, amountGross, fromMonth, toMonth }) => ({
      payee,
      amountGross,
      fromMonth,
      toMonth,
    })),
    invoices: invoices.map(({ payee, fromDate, toDate, amountGross, note }) => ({
      payee,
      fromDate,
      toDate,
      amountGross,
      note,
    })),
  };
}

/** Formularfelder einer Tarifkomponente in das Format von parseTariffComponent. */
export function tariffInputFromForm(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return typeof v === 'string' ? v : '';
  };
  const price = get('price');
  const window = parseWindow(get('windowMonths'), get('windowHours'));
  return {
    payee: get('payee'),
    category: get('category'),
    name: get('name'),
    unit: get('unit'),
    vatPct: get('vatPct'),
    ...(get('priceMode') === 'gross' ? { priceGross: price } : { priceNet: price }),
    validFrom: get('validFrom'),
    validTo: get('validTo'),
    window,
    note: get('note'),
  };
}

export function formRecord(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd) if (typeof v === 'string') out[k] = v;
  return out;
}

/** ID aus dem Formular; leer = neu. */
export function formId(fd: FormData): number | undefined {
  const id = Number(fd.get('id'));
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export type CostsView = Awaited<ReturnType<typeof loadCosts>>;
