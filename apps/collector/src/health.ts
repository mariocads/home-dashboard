import { createServer, type Server } from 'node:http';
import type { AdapterStatus } from './adapter.ts';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  adapters: AdapterStatus[];
}

export function buildHealthReport(
  adapters: AdapterStatus[],
  startedAt: Date,
  now = new Date(),
): HealthReport {
  return {
    status: adapters.every((a) => a.running && a.lastError === null) ? 'ok' : 'degraded',
    uptimeSeconds: Math.floor((now.getTime() - startedAt.getTime()) / 1000),
    adapters,
  };
}

/** Minimaler HTTP-Server für den Docker-Healthcheck (nur im internen Netz erreichbar). */
export function createHealthServer(report: () => HealthReport): Server {
  return createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const body = report();
    res
      .writeHead(body.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify(body));
  });
}
