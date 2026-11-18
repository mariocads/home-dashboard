import type { Db } from '@hd/db';

/** Status eines Adapters für Healthcheck und Überwachung. */
export interface AdapterStatus {
  name: string;
  running: boolean;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

/**
 * Eine Datenquelle (AMIS-Leser, go-e, ISG, wmbusmeters, …).
 * Adapter lesen nur – sie steuern keine Geräte.
 */
export interface Adapter {
  readonly name: string;
  start(ctx: AdapterContext): Promise<void>;
  stop(): Promise<void>;
  status(): AdapterStatus;
}

export interface AdapterContext {
  db: Db;
  log: Logger;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string, write: (line: string) => void = console.log): Logger {
  const emit = (level: string, msg: string, data?: Record<string, unknown>) =>
    write(JSON.stringify({ time: new Date().toISOString(), level, component, msg, ...data }));
  return {
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
  };
}
