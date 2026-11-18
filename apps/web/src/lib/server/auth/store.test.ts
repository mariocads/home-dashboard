import { createDb, type DbHandle, runMigrations, schema } from '@hd/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumeRecoveryCode,
  consumeSetupToken,
  countRecoveryCodes,
  createSession,
  createSetupToken,
  deletePasskey,
  deleteSession,
  findAdmin,
  getOrCreateAdmin,
  isSetupTokenValid,
  listPasskeys,
  purgeExpired,
  regenerateRecoveryCodes,
  saveChallenge,
  takeChallenge,
  validateSession,
} from './store.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('auth store (PGlite)', () => {
  let h: DbHandle;
  let userId: string;

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    expect(await findAdmin(h.db)).toBeNull();
    userId = (await getOrCreateAdmin(h.db)).id;
  });

  afterAll(async () => {
    await h.close();
  });

  it('getOrCreateAdmin ist idempotent', async () => {
    expect((await getOrCreateAdmin(h.db)).id).toBe(userId);
    expect((await findAdmin(h.db))?.id).toBe(userId);
  });

  describe('Sessions', () => {
    it('gültig → User; unbekannt → null', async () => {
      const { token } = await createSession(h.db, userId, 30);
      expect((await validateSession(h.db, token, 30))?.user.id).toBe(userId);
      expect(await validateSession(h.db, 'falsch', 30)).toBeNull();
    });

    it('abgelaufen → null und gelöscht', async () => {
      const past = new Date(Date.now() - 31 * DAY);
      const { token } = await createSession(h.db, userId, 30, past);
      expect(await validateSession(h.db, token, 30)).toBeNull();
      expect(await validateSession(h.db, token, 30, past)).toBeNull();
    });

    it('verlängert sliding, wenn weniger als die Hälfte übrig ist', async () => {
      const now = new Date();
      const { token, expiresAt } = await createSession(h.db, userId, 30, now);
      const later = new Date(now.getTime() + 20 * DAY);
      const v = await validateSession(h.db, token, 30, later);
      expect(v!.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
      const soon = new Date(now.getTime() + 1 * DAY);
      const unchanged = await validateSession(h.db, token, 30, soon);
      expect(unchanged!.expiresAt.getTime()).toBe(v!.expiresAt.getTime());
    });

    it('deleteSession und purgeExpired', async () => {
      const { token } = await createSession(h.db, userId, 30);
      const v = await validateSession(h.db, token, 30);
      await deleteSession(h.db, v!.sessionId);
      expect(await validateSession(h.db, token, 30)).toBeNull();
      await expect(purgeExpired(h.db)).resolves.toBeUndefined();
    });
  });

  describe('Setup-Token', () => {
    it('einmalig verwendbar', async () => {
      const { token } = await createSetupToken(h.db);
      expect(await isSetupTokenValid(h.db, token)).toBe(true);
      expect(await consumeSetupToken(h.db, token)).toBe(true);
      expect(await consumeSetupToken(h.db, token)).toBe(false);
      expect(await isSetupTokenValid(h.db, token)).toBe(false);
    });

    it('läuft ab', async () => {
      const { token } = await createSetupToken(h.db, 30, new Date(Date.now() - 31 * 60_000));
      expect(await isSetupTokenValid(h.db, token)).toBe(false);
      expect(await consumeSetupToken(h.db, token)).toBe(false);
    });
  });

  describe('Challenges', () => {
    it('einmalig, zweckgebunden, mit Ablauf', async () => {
      const id = await saveChallenge(h.db, 'abc', 'login', null);
      expect((await takeChallenge(h.db, id, 'login'))?.challenge).toBe('abc');
      expect(await takeChallenge(h.db, id, 'login')).toBeNull();

      const wrong = await saveChallenge(h.db, 'x', 'register', userId);
      expect(await takeChallenge(h.db, wrong, 'login')).toBeNull();

      const old = await saveChallenge(h.db, 'y', 'login', null, new Date(Date.now() - 10 * 60_000));
      expect(await takeChallenge(h.db, old, 'login')).toBeNull();
    });
  });

  describe('Recovery-Codes', () => {
    it('10 Codes, jeder einmal einlösbar, Eingabe tolerant', async () => {
      const codes = await regenerateRecoveryCodes(h.db, userId);
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect(await countRecoveryCodes(h.db, userId)).toBe(10);

      const sloppy = ` ${codes[0]!.toLowerCase().replaceAll('-', ' ')} `;
      expect(await consumeRecoveryCode(h.db, sloppy)).toBe(userId);
      expect(await consumeRecoveryCode(h.db, codes[0]!)).toBeNull();
      expect(await consumeRecoveryCode(h.db, 'kein-code')).toBeNull();
      expect(await countRecoveryCodes(h.db, userId)).toBe(9);
    });

    it('Neu erzeugen macht alte Codes ungültig', async () => {
      const old = await regenerateRecoveryCodes(h.db, userId);
      await regenerateRecoveryCodes(h.db, userId);
      expect(await consumeRecoveryCode(h.db, old[1]!)).toBeNull();
    });
  });

  describe('Passkeys', () => {
    it('letzter Passkey kann nicht gelöscht werden', async () => {
      const base = { userId, publicKey: 'pk', deviceType: 'singleDevice', name: 'Test' };
      await h.db.insert(schema.passkeys).values([
        { ...base, id: 'cred-1' },
        { ...base, id: 'cred-2' },
      ]);
      await deletePasskey(h.db, userId, 'cred-1');
      expect((await listPasskeys(h.db, userId)).map((p) => p.id)).toEqual(['cred-2']);
      await expect(deletePasskey(h.db, userId, 'cred-2')).rejects.toThrow(/letzte/);
    });
  });
});
