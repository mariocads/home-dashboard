import { ensureMeter, getSetting, insertReadings, saveAdapterStatus } from '@hd/db';
import {
  ISG_BLOCKS,
  ISG_POLL_INTERVAL,
  ISG_SOURCE,
  isgRegistersToReadings,
  registersFromBlocks,
  resolveIntegerSetting,
  WP_METER,
  WP_QUANTITY,
} from '@hd/domain';
import type { Adapter, AdapterContext, AdapterStatus } from '../adapter.ts';
import { connectModbus, ModbusError, type ModbusOptions, type ModbusSession } from '../modbus.ts';
import { nextDelayMs } from './amis.ts';

export const DEFAULT_ISG_HOST = 'servicewelt.fritz.box';

export interface IsgAdapterOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  now?: () => number;
  settingsCheckMs?: number;
  /** Für Tests austauschbar */
  connect?: (opts: ModbusOptions) => Promise<ModbusSession>;
}

function describeError(e: unknown): string {
  const err = e as Error;
  return `${err.name}: ${err.message}`;
}

/**
 * Liest die Wärmepumpe über die Stiebel ISG (Modbus TCP, nur lesend) und schreibt Temperaturen,
 * Drücke, Zähler und Leistung in readings. Pro Abfrage eine kurze Verbindung, damit eine hängende
 * Verbindung die nächste Abfrage nicht blockiert. Das Intervall kommt aus den Einstellungen.
 */
export function createIsgAdapter(opts: IsgAdapterOptions): Adapter & { pollOnce(): Promise<void> } {
  const port = opts.port ?? 502;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const now = opts.now ?? Date.now;
  const settingsCheckMs = opts.settingsCheckMs ?? 10_000;
  const connect = opts.connect ?? connectModbus;
  const target = `${opts.host}:${port}`;

  let ctx: AdapterContext | null = null;
  let meterId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastPollAt: number | null = null;
  /** Blöcke, die das Gerät zuletzt abgelehnt hat (nur für die Protokollierung von Änderungen) */
  let rejected = '';
  const state: Pick<AdapterStatus, 'lastSuccessAt' | 'lastError'> = { lastSuccessAt: null, lastError: null };

  /** Liest alle Blöcke; ein vom Gerät abgelehnter Block entfällt, Verbindungsfehler brechen ab. */
  async function readBlocks() {
    const session = await connect({ host: opts.host, port, timeoutMs });
    try {
      const blocks: { start: number; values: number[] }[] = [];
      const failed: string[] = [];
      for (const [start, count] of ISG_BLOCKS) {
        try {
          blocks.push({ start, values: await session.readInputRegisters(start - 1, count) });
        } catch (e) {
          if (!(e instanceof ModbusError)) throw e;
          failed.push(`${start} (Ausnahme ${e.code})`);
        }
      }
      if (blocks.length === 0) throw new ModbusError(0, `Alle Blöcke abgelehnt: ${failed.join(', ')}`);
      return { regs: registersFromBlocks(blocks), failed };
    } finally {
      session.close();
    }
  }

  async function pollOnce(): Promise<void> {
    if (!ctx || meterId === null) throw new Error('Adapter nicht gestartet');
    lastPollAt = now();
    try {
      const { regs, failed } = await readBlocks();
      const ts = new Date(now());
      const rows = isgRegistersToReadings(regs, ts);
      await insertReadings(ctx.db, meterId, ISG_SOURCE, rows);
      if (failed.join() !== rejected) {
        rejected = failed.join();
        if (failed.length) ctx.log.warn('ISG lehnt einzelne Blöcke ab', { blocks: failed });
      }
      if (state.lastError !== null || state.lastSuccessAt === null) {
        const outdoor = rows.find((r) => r.quantity === WP_QUANTITY.outdoorC)?.value;
        ctx.log.info('Wärmepumpe liefert Daten', { values: rows.length, outdoorC: outdoor });
      }
      state.lastSuccessAt = ts;
      state.lastError = null;
    } catch (e) {
      state.lastError = describeError(e);
      ctx.log.warn('ISG-Abfrage fehlgeschlagen', { error: state.lastError });
    }
    try {
      await saveAdapterStatus(ctx.db, { name: 'isg', target, ...state }, new Date(now()));
    } catch (e) {
      ctx.log.warn('Status konnte nicht gespeichert werden', { error: describeError(e) });
    }
  }

  async function tick(): Promise<void> {
    if (!running || !ctx) return;
    let delay: number;
    try {
      const intervalS = resolveIntegerSetting(
        ISG_POLL_INTERVAL,
        await getSetting(ctx.db, ISG_POLL_INTERVAL.key),
      );
      if (nextDelayMs(lastPollAt, intervalS, now(), settingsCheckMs) === 0) await pollOnce();
      delay = nextDelayMs(lastPollAt, intervalS, now(), settingsCheckMs);
    } catch (e) {
      state.lastError = describeError(e);
      ctx.log.error('ISG-Adapter: Fehler im Ablauf', { error: state.lastError });
      delay = settingsCheckMs;
    }
    if (running) timer = setTimeout(() => void tick(), delay);
  }

  return {
    name: 'isg',
    async start(c) {
      ctx = c;
      meterId = await ensureMeter(c.db, WP_METER);
      running = true;
      c.log.info('ISG-Adapter gestartet', { target });
      await tick();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    status: () => ({ name: 'isg', running, ...state }),
    pollOnce,
  };
}
