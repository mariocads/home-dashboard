import { createHash } from 'node:crypto';
import {
  edgeReading,
  findMeterId,
  getSetting,
  latestReading,
  markChargeReportFailed,
  markChargeReportSent,
  markChargeTestMail,
  pendingChargeReports,
  requestChargeReport,
  saveAdapterStatus,
  saveChargeExport,
  setChargeReportError,
  type ChargeReportRow,
} from '@hd/db';
import {
  buildChargeReportMail,
  CHARGE_REPORT_BODY,
  CHARGE_REPORT_FILENAME,
  CHARGE_REPORT_RECIPIENT,
  CHARGE_REPORT_SUBJECT,
  chargeExportReady,
  dueChargeQuarter,
  GOE_QUANTITY,
  goeExportUrl,
  parseGoeChargeCsv,
  parseQuarterKey,
  type Quarter,
  quarterKey,
  quarterRange,
  resolveTextSetting,
  summarizeChargeSessions,
  WALLBOX_METER,
} from '@hd/domain';
import nodemailer from 'nodemailer';
import type { Adapter, AdapterContext, AdapterStatus } from './adapter.ts';

// Lade-Aufstellung der Wallbox: legt zum Quartalsende ein Todo an, holt den originalen CSV-Export
// aus der go-e-Cloud und verschickt ihn nach der Freigabe in der App per Mail.
// Der Export-Link der Wallbox enthält ein Token: Er wird bei Bedarf frisch gelesen und nie
// gespeichert oder geloggt. Gleiches gilt für Empfänger und Inhalt des Exports.

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Absender, Standard: user */
  from: string;
}

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachment: { filename: string; content: string };
}

export type SendMail = (mail: OutgoingMail) => Promise<void>;

/** SMTP aus der Umgebung; ohne SMTP_USER und SMTP_PASS ist der Versand aus (Standard: Gmail). */
export function mailConfigFromEnv(env: Record<string, string | undefined>): MailConfig | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.replace(/\s+/g, '');
  if (!user || !pass) return null;
  return {
    host: env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port: Number(env.SMTP_PORT) || 465,
    user,
    pass,
    from: env.SMTP_FROM?.trim() || user,
  };
}

export function createSmtpSender(cfg: MailConfig): SendMail {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    requireTLS: cfg.port !== 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 20_000,
    socketTimeout: 30_000,
  });
  return async (m) => {
    await transport.sendMail({
      from: m.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      attachments: [
        {
          filename: m.attachment.filename,
          content: m.attachment.content,
          contentType: 'text/csv; charset=utf-8',
        },
      ],
    });
  };
}

export interface ChargeReportJobOptions {
  /** IP der Wallbox; ohne sie kann kein Export geholt werden */
  goeHost: string | null;
  mail: MailConfig | null;
  send?: SendMail;
  fetch?: typeof fetch;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}

/** Fehlermeldung ohne URL, Token oder Antwortinhalt. */
export function describeError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string }; code?: string; responseCode?: number };
  const code = err.cause?.code ?? err.code;
  const detail = err.responseCode ? ` (SMTP ${err.responseCode})` : code ? ` (${code})` : '';
  return `${err.name}: ${err.message.replace(/https?:\/\/\S+/g, '<url>')}${detail}`.slice(0, 500);
}

export function createChargeReportJob(opts: ChargeReportJobOptions): Adapter & { runOnce(): Promise<void> } {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const send = opts.send ?? (opts.mail ? createSmtpSender(opts.mail) : null);

  let ctx: AdapterContext | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const state: Pick<AdapterStatus, 'lastSuccessAt' | 'lastError'> = { lastSuccessAt: null, lastError: null };

  async function carState(): Promise<number | null> {
    const r = await latestReading(ctx!.db, WALLBOX_METER.slug, GOE_QUANTITY.carState);
    // Älter als 15 Minuten: Zustand unbekannt
    return r && now() - r.ts.getTime() < 15 * 60_000 ? r.value : null;
  }

  async function fetchExport(row: ChargeReportRow, q: Quarter): Promise<void> {
    const db = ctx!.db;
    if (!opts.goeHost) {
      await setChargeReportError(db, row.quarter, 'GOE_HOST ist nicht gesetzt', new Date(now()));
      return;
    }
    const t = new Date(now());
    const ready = row.refreshRequestedAt
      ? t.getTime() >= quarterRange(q).end.getTime()
      : chargeExportReady(q, t, await carState());
    if (!ready) return;
    try {
      const host = /^https?:\/\//.test(opts.goeHost)
        ? opts.goeHost.replace(/\/+$/, '')
        : `http://${opts.goeHost}`;
      const statusRes = await doFetch(`${host}/api/status?filter=dll`, { signal: AbortSignal.timeout(5000) });
      if (!statusRes.ok) throw new Error(`Wallbox: HTTP ${statusRes.status}`);
      const { dll } = (await statusRes.json()) as { dll?: unknown };
      const res = await doFetch(goeExportUrl(dll, q), { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`go-e-Cloud: HTTP ${res.status}`);
      const csv = await res.text();
      const summary = summarizeChargeSessions(parseGoeChargeCsv(csv), q);
      await saveChargeExport(
        db,
        row.quarter,
        {
          csv,
          csvSha256: createHash('sha256').update(csv).digest('hex'),
          sessionCount: summary.count,
          energyKwh: summary.energyKwh,
        },
        new Date(now()),
      );
      ctx!.log.info('Lade-Aufstellung geholt', { quarter: row.quarter, sessions: summary.count });
    } catch (e) {
      const error = describeError(e);
      await setChargeReportError(db, row.quarter, error, new Date(now()));
      ctx!.log.warn('Lade-Aufstellung: Export fehlgeschlagen', { quarter: row.quarter, error });
    }
  }

  async function compose(row: ChargeReportRow, q: Quarter) {
    const db = ctx!.db;
    const [recipient, subject, filename, body] = await Promise.all(
      [CHARGE_REPORT_RECIPIENT, CHARGE_REPORT_SUBJECT, CHARGE_REPORT_FILENAME, CHARGE_REPORT_BODY].map(
        async (d) => resolveTextSetting(d, await getSetting(db, d.key)),
      ),
    );
    const texts = buildChargeReportMail({ subject: subject!, filename: filename!, body: body! }, q, {
      count: row.sessionCount ?? 0,
      energyKwh: row.energyKwh ?? 0,
    });
    return { recipient: recipient!, ...texts };
  }

  async function sendReport(row: ChargeReportRow, q: Quarter, test: boolean): Promise<void> {
    const db = ctx!.db;
    const fail = (error: string) =>
      test
        ? markChargeTestMail(db, row.quarter, error, new Date(now()))
        : markChargeReportFailed(db, row.quarter, error, new Date(now()));
    if (!send || !opts.mail)
      return void (await fail('Mailversand nicht eingerichtet: SMTP_USER und SMTP_PASS in der .env setzen'));
    if (!row.csv) return void (await fail('Kein Export vorhanden'));
    if (!test && row.approvedSha256 !== row.csvSha256)
      return void (await fail('Der Export hat sich nach der Freigabe geändert'));
    const m = await compose(row, q);
    const to = test ? opts.mail.from : m.recipient;
    if (!to)
      return void (await fail('Kein Empfänger: in den Einstellungen unter Lade-Aufstellung eintragen'));
    try {
      await send({
        from: opts.mail.from,
        to,
        subject: test ? `[Test] ${m.subject}` : m.subject,
        text: m.body,
        attachment: { filename: m.filename, content: row.csv },
      });
      if (test) await markChargeTestMail(db, row.quarter, null, new Date(now()));
      else await markChargeReportSent(db, row.quarter, to, new Date(now()));
      ctx!.log.info(test ? 'Lade-Aufstellung: Testmail verschickt' : 'Lade-Aufstellung verschickt', {
        quarter: row.quarter,
      });
    } catch (e) {
      const error = describeError(e);
      await fail(error);
      ctx!.log.warn('Lade-Aufstellung: Mailversand fehlgeschlagen', { quarter: row.quarter, error });
    }
  }

  async function runOnce(): Promise<void> {
    if (!ctx) throw new Error('Job nicht gestartet');
    const db = ctx.db;
    const t = new Date(now());

    // Todo zum Quartalsende anlegen, sobald es Wallbox-Daten gibt
    const meterId = await findMeterId(db, WALLBOX_METER.slug);
    const first =
      meterId === null ? null : await edgeReading(db, meterId, GOE_QUANTITY.counterKwh, null, t, 'first');
    const due = dueChargeQuarter(t, first?.ts ?? null);
    if (due && (await requestChargeReport(db, quarterKey(due), t))) {
      ctx.log.info('Lade-Aufstellung angelegt', { quarter: quarterKey(due) });
    }

    for (const row of await pendingChargeReports(db)) {
      const q = parseQuarterKey(row.quarter);
      if (!q) continue;
      if (row.status === 'requested' || row.refreshRequestedAt) await fetchExport(row, q);
      if (row.status === 'approved') await sendReport(row, q, false);
      if (row.testRequestedAt) await sendReport(row, q, true);
    }

    // Für die App: ist der Versand eingerichtet, läuft der Job?
    await saveAdapterStatus(
      db,
      {
        name: 'mail',
        target: opts.mail ? `${opts.mail.from} über ${opts.mail.host}:${opts.mail.port}` : null,
        lastSuccessAt: state.lastSuccessAt,
        lastError: opts.mail ? null : 'SMTP_USER und SMTP_PASS fehlen in der .env',
      },
      t,
    );
  }

  async function tick(): Promise<void> {
    if (!running || !ctx) return;
    try {
      await runOnce();
      state.lastSuccessAt = new Date(now());
      state.lastError = null;
    } catch (e) {
      state.lastError = describeError(e);
      ctx.log.error('Lade-Aufstellung: Fehler im Ablauf', { error: state.lastError });
    }
    if (running) timer = setTimeout(() => void tick(), intervalMs);
  }

  return {
    name: 'charge-report',
    async start(c) {
      ctx = c;
      running = true;
      c.log.info('Lade-Aufstellung gestartet', { mail: opts.mail ? 'eingerichtet' : 'aus' });
      await tick();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    status: () => ({ name: 'charge-report', running, ...state }),
    runOnce,
  };
}
