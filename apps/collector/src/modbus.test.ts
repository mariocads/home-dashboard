import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { connectModbus, encodeReadRequest, ModbusError, takeFrame } from './modbus.ts';

/** Antwortrahmen eines Geräts für Funktion 04. */
function response(id: number, registers: number[]): Buffer {
  const buf = Buffer.alloc(9 + registers.length * 2);
  buf.writeUInt16BE(id, 0);
  buf.writeUInt16BE(0, 2);
  buf.writeUInt16BE(3 + registers.length * 2, 4);
  buf.writeUInt8(1, 6);
  buf.writeUInt8(4, 7);
  buf.writeUInt8(registers.length * 2, 8);
  registers.forEach((r, i) => buf.writeUInt16BE(r, 9 + i * 2));
  return buf;
}

function exception(id: number, code: number): Buffer {
  return Buffer.from([id >> 8, id & 0xff, 0, 0, 0, 3, 1, 0x84, code]);
}

describe('Modbus-Rahmen', () => {
  it('kodiert eine Leseanfrage', () => {
    expect([...encodeReadRequest(7, 1, 500, 113)]).toEqual([0, 7, 0, 0, 0, 6, 1, 4, 0x01, 0xf4, 0, 113]);
  });

  it('wartet auf fehlende Bytes und trennt mehrere Rahmen', () => {
    const two = Buffer.concat([response(1, [1, 0xffff]), exception(2, 2)]);
    expect(takeFrame(two.subarray(0, 10))).toBeNull();
    const first = takeFrame(two)!;
    expect(first.frame).toEqual({ transactionId: 1, registers: [1, 0xffff] });
    const second = takeFrame(first.rest)!;
    expect(second.frame).toMatchObject({ transactionId: 2, error: { code: 2 } });
    expect(second.rest.length).toBe(0);
  });

  it('lehnt fremde Protokolle ab', () => {
    expect(() => takeFrame(Buffer.from('HTTP/1.1 400 Bad'))).toThrow(/Ungültige/);
  });
});

describe('Modbus-Verbindung', () => {
  let server: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  /** Testgerät: Register = Adresse + 1, ab Adresse 1000 Ausnahme 2; Antworten in Stücken. */
  async function start(handler?: (socket: Socket, req: Buffer) => void): Promise<number> {
    server = createServer((socket) => {
      socket.on('data', (req: Buffer) => {
        if (handler) return handler(socket, req);
        const id = req.readUInt16BE(0);
        const address = req.readUInt16BE(8);
        const count = req.readUInt16BE(10);
        const frame =
          address >= 1000
            ? exception(id, 2)
            : response(
                id,
                Array.from({ length: count }, (_, i) => address + i + 1),
              );
        socket.write(frame.subarray(0, 5));
        setTimeout(() => socket.write(frame.subarray(5)), 5);
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return (server!.address() as { port: number }).port;
  }

  it('liest nacheinander mehrere Blöcke über eine Verbindung', async () => {
    const port = await start();
    const s = await connectModbus({ host: '127.0.0.1', port, timeoutMs: 1000 });
    expect(await s.readInputRegisters(500, 3)).toEqual([501, 502, 503]);
    expect(await s.readInputRegisters(3500, 1).catch((e: unknown) => e)).toBeInstanceOf(Error);
    s.close();
  });

  it('meldet Ausnahmen des Geräts als ModbusError', async () => {
    const port = await start();
    const s = await connectModbus({ host: '127.0.0.1', port, timeoutMs: 1000 });
    const e = await s.readInputRegisters(1000, 10).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ModbusError);
    expect((e as ModbusError).code).toBe(2);
    // die Verbindung bleibt nutzbar
    expect(await s.readInputRegisters(0, 1)).toEqual([1]);
    s.close();
  });

  it('Zeitlimit, wenn das Gerät nicht antwortet', async () => {
    const port = await start(() => {});
    const s = await connectModbus({ host: '127.0.0.1', port, timeoutMs: 100 });
    await expect(s.readInputRegisters(0, 1)).rejects.toMatchObject({ name: 'TimeoutError' });
    await expect(s.readInputRegisters(0, 1)).rejects.toThrow();
    s.close();
  });

  it('Verbindungsfehler mit Code', async () => {
    const port = await start();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    await expect(connectModbus({ host: '127.0.0.1', port, timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});
