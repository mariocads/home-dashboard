export interface AppConfig {
  databaseUrl: string;
  /** WebAuthn Relying-Party-ID = Hostname, z. B. home-server.fritz.box. Nicht mehr ändern, sonst werden Passkeys ungültig. */
  rpId: string;
  rpName: string;
  /** Erwartete Origin für WebAuthn, z. B. https://home-server.fritz.box */
  origin: string;
  sessionDays: number;
  secureCookies: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const origin = env.ORIGIN ?? 'http://localhost:5173';
  const url = new URL(origin);
  return {
    databaseUrl: env.DATABASE_URL ?? 'pglite://.pglite/dev',
    rpId: env.RP_ID ?? url.hostname,
    rpName: env.RP_NAME ?? 'Home Dashboard',
    origin: url.origin,
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    secureCookies: url.protocol === 'https:',
  };
}
