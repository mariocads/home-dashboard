import {
  type Db,
  edgeReading,
  findMeterId,
  getAdapterStatus,
  getChargeReport,
  getSetting,
  listChargeReports,
} from '@hd/db';
import {
  buildChargeReportMail,
  CHARGE_REPORT_SETTINGS,
  type ChargeReportStatus,
  GOE_QUANTITY,
  OPEN_CHARGE_REPORT_STATUS,
  parseGoeChargeCsv,
  parseQuarterKey,
  previousQuarter,
  type Quarter,
  quarterKey,
  quarterLabel,
  quarterOf,
  quarterPeriodLabel,
  quarterRange,
  resolveTextSetting,
  summarizeChargeSessions,
  WALLBOX_METER,
} from '@hd/domain';

export const STATUS_LABELS: Record<ChargeReportStatus, string> = {
  requested: 'Export wird geholt',
  review: 'Prüfen und freigeben',
  approved: 'Wird gesendet',
  sent: 'Gesendet',
  failed: 'Versand fehlgeschlagen',
  skipped: 'Übersprungen',
};

export interface ChargeTodo {
  quarter: string;
  label: string;
  status: ChargeReportStatus;
  statusLabel: string;
}

/** Offene Lade-Aufstellungen für die Übersicht. */
export async function loadChargeTodos(db: Db): Promise<ChargeTodo[]> {
  const rows = await listChargeReports(db);
  return rows
    .filter((r) => OPEN_CHARGE_REPORT_STATUS.includes(r.status as ChargeReportStatus))
    .map((r) => {
      const status = r.status as ChargeReportStatus;
      return {
        quarter: r.quarter,
        label: quarterLabel(parseQuarterKey(r.quarter)!),
        status,
        statusLabel: STATUS_LABELS[status],
      };
    });
}

export async function loadChargeTexts(db: Db) {
  const [recipient, subject, filename, body] = await Promise.all(
    CHARGE_REPORT_SETTINGS.map(async (d) => resolveTextSetting(d, await getSetting(db, d.key))),
  );
  return { recipient: recipient!, subject: subject!, filename: filename!, body: body! };
}

export interface MailStatus {
  state: 'ready' | 'off' | 'collector' | 'waiting';
  /** Absender und Server, z. B. „x@gmail.com über smtp.gmail.com:465“ */
  target: string | null;
  hint: string | null;
}

/** Zustand des Mailversands aus Sicht des Collectors (meldet sich alle 15 s). */
export async function getMailStatus(db: Db, now = new Date()): Promise<MailStatus> {
  const row = await getAdapterStatus(db, 'mail');
  if (!row) return { state: 'waiting', target: null, hint: 'Der Collector hat sich noch nicht gemeldet.' };
  if (now.getTime() - row.updatedAt.getTime() > 3 * 60_000) {
    return {
      state: 'collector',
      target: row.target,
      hint: 'Der Collector läuft nicht. Am Server „docker compose logs collector“ prüfen.',
    };
  }
  if (row.lastError) {
    return {
      state: 'off',
      target: null,
      hint: 'Nicht eingerichtet: SMTP_USER und SMTP_PASS (Gmail-App-Passwort) in der .env setzen, dann ./deploy.sh.',
    };
  }
  return { state: 'ready', target: row.target, hint: null };
}

export async function loadChargeReportList(db: Db, now = new Date()) {
  const rows = await listChargeReports(db);
  const existing = new Set(rows.map((r) => r.quarter));
  // Abgeschlossene Quartale des letzten Jahres, die noch fehlen (manuell anfordern)
  const requestable: { key: string; label: string }[] = [];
  let q = previousQuarter(quarterOf(now));
  for (let i = 0; i < 4; i++, q = previousQuarter(q)) {
    if (!existing.has(quarterKey(q))) requestable.push({ key: quarterKey(q), label: quarterLabel(q) });
  }
  return {
    reports: rows.map((r) => ({
      quarter: r.quarter,
      label: quarterLabel(parseQuarterKey(r.quarter)!),
      status: r.status as ChargeReportStatus,
      statusLabel: STATUS_LABELS[r.status as ChargeReportStatus],
      sessionCount: r.sessionCount,
      energyKwh: r.energyKwh,
      sentAt: r.sentAt?.toISOString() ?? null,
    })),
    requestable,
  };
}

/** Eigene Zählerdifferenz der Wallbox im Quartal, nur wenn die Messung das ganze Quartal abdeckt. */
async function ownMeasurement(db: Db, q: Quarter) {
  const meterId = await findMeterId(db, WALLBOX_METER.slug);
  if (meterId === null) return null;
  const { start, end } = quarterRange(q);
  const [first, last] = await Promise.all([
    edgeReading(db, meterId, GOE_QUANTITY.counterKwh, start, end, 'first'),
    edgeReading(db, meterId, GOE_QUANTITY.counterKwh, start, end, 'last'),
  ]);
  if (!first || !last) return null;
  return {
    from: first.ts.toISOString(),
    complete: first.ts.getTime() - start.getTime() < 3_600_000,
    kwh: Math.round((last.value - first.value) * 1000) / 1000,
  };
}

export async function loadChargeReport(db: Db, key: string, now = new Date()) {
  const q = parseQuarterKey(key);
  if (!q) return null;
  const row = await getChargeReport(db, key);
  if (!row) return null;

  let sessions: ReturnType<typeof parseGoeChargeCsv> = [];
  let parseError: string | null = null;
  if (row.csv) {
    try {
      sessions = parseGoeChargeCsv(row.csv);
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  const summary = summarizeChargeSessions(sessions, q);
  const texts = await loadChargeTexts(db);
  const mail = buildChargeReportMail(texts, q, summary);
  const status = row.status as ChargeReportStatus;

  return {
    quarter: key,
    label: quarterLabel(q),
    period: quarterPeriodLabel(q),
    status,
    statusLabel: STATUS_LABELS[status],
    hasCsv: !!row.csv,
    csvSha256: row.csvSha256,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    sentTo: row.sentTo,
    lastError: row.lastError,
    refreshPending: !!row.refreshRequestedAt,
    testPending: !!row.testRequestedAt,
    testSentAt: row.testSentAt?.toISOString() ?? null,
    parseError,
    sessions: sessions.map((s) => ({
      number: s.number,
      start: s.start?.toISOString() ?? null,
      end: s.end?.toISOString() ?? null,
      duration: s.duration,
      energyKwh: s.energyKwh,
      counterStartKwh: s.counterStartKwh,
      counterEndKwh: s.counterEndKwh,
    })),
    summary,
    own: await ownMeasurement(db, q),
    mail: { to: texts.recipient, subject: mail.subject, filename: mail.filename, body: mail.body },
    mailStatus: await getMailStatus(db, now),
  };
}
