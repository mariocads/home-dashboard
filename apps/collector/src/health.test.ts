import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { AdapterStatus } from './adapter.ts';
import { createLogger } from './adapter.ts';
import { buildHealthReport, createHealthServer } from './health.ts';

const adapter = (over: Partial<AdapterStatus> = {}): AdapterStatus => ({
  name: 'x',
  running: true,
  lastSuccessAt: null,
  lastError: null,
  ...over,
});

describe('health', () => {
  const start = new Date('2026-01-01T00:00:00Z');

  it('ok ohne Adapter und bei gesunden Adaptern', () => {
    expect(buildHealthReport([], start, new Date('2026-01-01T00:01:00Z'))).toEqual({
      status: 'ok',
      uptimeSeconds: 60,
      adapters: [],
    });
    expect(buildHealthReport([adapter()], start).status).toBe('ok');
  });

  it('degraded bei Fehler oder gestopptem Adapter', () => {
    expect(buildHealthReport([adapter({ lastError: 'timeout' })], start).status).toBe('degraded');
    expect(buildHealthReport([adapter({ running: false })], start).status).toBe('degraded');
  });

  it('HTTP: 200/503/404', async () => {
    let report = buildHealthReport([], start);
    const server = createHealthServer(() => report).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      report = buildHealthReport([adapter({ running: false })], start);
      expect((await fetch(`${base}/health`)).status).toBe(503);
      expect((await fetch(`${base}/other`)).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('Logger schreibt strukturiertes JSON', () => {
    const lines: string[] = [];
    const log = createLogger('test', (l) => lines.push(l));
    log.info('hallo', { n: 1 });
    log.warn('w');
    log.error('e');
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', component: 'test', msg: 'hallo', n: 1 });
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(['info', 'warn', 'error']);
  });
});
