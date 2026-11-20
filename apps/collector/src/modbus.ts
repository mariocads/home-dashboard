import { Socket } from 'node:net';

// Minimaler Modbus-TCP-Client, nur Funktion 04 (Input-Register lesen). Er schreibt nie und kann
// deshalb an der Anlage nichts verstellen. Anfragen laufen nacheinander über eine Verbindung.

/** Ausnahmeantwort des Geräts, z. B. Code 2 = Adresse gibt es nicht. */
export class ModbusError extends Error {
  override name = 'ModbusError';
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class ModbusTimeoutError extends Error {
  override name = 'TimeoutError';
}

export interface ModbusOptions {
  host: string;
  port?: number;
  unitId?: number;
  timeoutMs?: number;
}

export interface ModbusSession {
  /** Liest count Input-Register ab der Protokolladresse address (0-basiert). Werte 0…65535. */
  readInputRegisters(address: number, count: number): Promise<number[]>;
  close(): void;
}

const READ_INPUT_REGISTERS = 0x04;
const MBAP_LENGTH = 7;

/** Baut eine Anfrage (MBAP-Kopf + PDU). */
export function encodeReadRequest(transactionId: number, unitId: number, address: number, count: number) {
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(transactionId, 0);
  buf.writeUInt16BE(0, 2); // Protokoll 0 = Modbus
  buf.writeUInt16BE(6, 4); // folgende Bytes: Unit + PDU (5)
  buf.writeUInt8(unitId, 6);
  buf.writeUInt8(READ_INPUT_REGISTERS, 7);
  buf.writeUInt16BE(address, 8);
  buf.writeUInt16BE(count, 10);
  return buf;
}

export type DecodedFrame =
  { transactionId: number; registers: number[] } | { transactionId: number; error: ModbusError };

/**
 * Nimmt einen vollständigen Rahmen vom Anfang des Puffers. Liefert null, solange Bytes fehlen.
 * Wirft bei Rahmen, die kein Modbus TCP sind.
 */
export function takeFrame(buf: Buffer): { frame: DecodedFrame; rest: Buffer } | null {
  if (buf.length < MBAP_LENGTH + 1) return null;
  const length = buf.readUInt16BE(4);
  if (buf.readUInt16BE(2) !== 0 || length < 2 || length > 254) throw new Error('Ungültige Modbus-Antwort');
  const total = 6 + length;
  if (buf.length < total) return null;
  const transactionId = buf.readUInt16BE(0);
  const fc = buf.readUInt8(7);
  const rest = buf.subarray(total);
  if (fc === (READ_INPUT_REGISTERS | 0x80)) {
    const code = buf.readUInt8(8);
    return { frame: { transactionId, error: new ModbusError(code, `Modbus-Ausnahme ${code}`) }, rest };
  }
  if (fc !== READ_INPUT_REGISTERS) throw new Error(`Unerwartete Modbus-Funktion ${fc}`);
  const byteCount = buf.readUInt8(8);
  if (byteCount % 2 !== 0 || byteCount + 3 !== length) throw new Error('Ungültige Modbus-Antwort');
  const registers: number[] = [];
  for (let i = 0; i < byteCount; i += 2) registers.push(buf.readUInt16BE(9 + i));
  return { frame: { transactionId, registers }, rest };
}

/** Öffnet eine Verbindung. Jede Anfrage hat ein eigenes Zeitlimit. */
export function connectModbus(opts: ModbusOptions): Promise<ModbusSession> {
  const port = opts.port ?? 502;
  const unitId = opts.unitId ?? 1;
  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer: Buffer = Buffer.alloc(0);
    let nextId = 1;
    let pending: {
      id: number;
      count: number;
      resolve: (r: number[]) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    let failure: Error | null = null;

    const fail = (e: Error) => {
      failure ??= e;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(e);
        pending = null;
      }
      socket.destroy();
    };

    const connectTimer = setTimeout(() => {
      const e = new ModbusTimeoutError(`Keine Verbindung zu ${opts.host}:${port} nach ${timeoutMs} ms`);
      fail(e);
      reject(e);
    }, timeoutMs);

    socket.on('error', (e) => {
      clearTimeout(connectTimer);
      fail(e);
      reject(e);
    });
    socket.on('close', () => fail(new Error('Verbindung geschlossen')));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        for (let taken = takeFrame(buffer); taken; taken = takeFrame(buffer)) {
          buffer = taken.rest;
          const { frame } = taken;
          if (!pending || frame.transactionId !== pending.id) continue; // verspätete Antwort
          const p = pending;
          pending = null;
          clearTimeout(p.timer);
          if ('error' in frame) p.reject(frame.error);
          else if (frame.registers.length !== p.count) p.reject(new Error('Unvollständige Modbus-Antwort'));
          else p.resolve(frame.registers);
        }
      } catch (e) {
        fail(e as Error);
      }
    });

    socket.connect(port, opts.host, () => {
      clearTimeout(connectTimer);
      resolve({
        readInputRegisters(address, count) {
          if (failure) return Promise.reject(failure);
          if (pending) return Promise.reject(new Error('Es läuft bereits eine Anfrage'));
          if (count < 1 || count > 125)
            return Promise.reject(new RangeError('1 bis 125 Register je Anfrage'));
          return new Promise<number[]>((res, rej) => {
            const id = nextId;
            nextId = (nextId % 0xffff) + 1;
            const timer = setTimeout(
              () =>
                fail(new ModbusTimeoutError(`Keine Antwort von ${opts.host}:${port} nach ${timeoutMs} ms`)),
              timeoutMs,
            );
            pending = { id, count, resolve: res, reject: rej, timer };
            socket.write(encodeReadRequest(id, unitId, address, count));
          });
        },
        close() {
          failure ??= new Error('Verbindung geschlossen');
          socket.end();
          socket.destroy();
        },
      });
    });
  });
}
