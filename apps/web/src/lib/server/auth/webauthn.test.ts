import { createDb, type DbHandle, runMigrations, schema } from '@hd/db';
import type { Cookies } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { clearCookie, SESSION_COOKIE, setSessionCookie, setShortCookie } from './cookies.ts';
import { getOrCreateAdmin, saveChallenge } from './store.ts';
import { AuthError, finishLogin, finishRegistration, startLogin, startRegistration } from './webauthn.ts';

// Der vollständige Kryptografie-Pfad (echte Signaturen) wird im Playwright-Test mit virtuellem Authenticator geprüft.
// Hier: Optionen, Challenge-Handling und alle Ablehnungspfade.

const config = loadConfig({ ORIGIN: 'https://home.fritz.box' });

describe('webauthn', () => {
  let h: DbHandle;
  let user: { id: string; username: string };

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    const admin = await getOrCreateAdmin(h.db);
    user = { id: admin.id, username: admin.username };
  });

  afterAll(async () => {
    await h.close();
  });

  it('Registrierungsoptionen: RP, Passkey-Pflicht, bestehende Credentials ausgeschlossen', async () => {
    await h.db.insert(schema.passkeys).values({
      id: 'existing-cred',
      userId: user.id,
      publicKey: 'x',
      deviceType: 'multiDevice',
      name: 'Alt',
      transports: ['internal'],
    });
    const { options, challengeId } = await startRegistration(h.db, config, user);
    expect(options.rp).toEqual({ name: 'Home Dashboard', id: 'home.fritz.box' });
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(['existing-cred']);
    expect(challengeId).toBeTruthy();
  });

  it('Login-Optionen: discoverable credentials (keine allowCredentials)', async () => {
    const { options } = await startLogin(h.db, config);
    expect(options.rpId).toBe('home.fritz.box');
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe('required');
  });

  it('Registrierung: unbekannte Challenge wird abgelehnt', async () => {
    await expect(finishRegistration(h.db, config, 'unbekannt', {} as never, 'x')).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it('Registrierung: ungültige Antwort wird abgelehnt und Challenge verbraucht', async () => {
    const { challengeId } = await startRegistration(h.db, config, user);
    const bogus = {
      id: 'abc',
      rawId: 'abc',
      type: 'public-key',
      response: { clientDataJSON: 'e30', attestationObject: 'AA' },
      clientExtensionResults: {},
    };
    await expect(finishRegistration(h.db, config, challengeId, bogus as never, 'x')).rejects.toThrow();
    // Zweiter Versuch mit derselben Challenge: bereits verbraucht
    await expect(finishRegistration(h.db, config, challengeId, bogus as never, 'x')).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it('Login: unbekannte Challenge und unbekannter Passkey werden abgelehnt', async () => {
    await expect(finishLogin(h.db, config, 'unbekannt', { id: 'x' } as never)).rejects.toBeInstanceOf(
      AuthError,
    );
    const challengeId = await saveChallenge(h.db, 'c', 'login', null);
    await expect(finishLogin(h.db, config, challengeId, { id: 'gibt-es-nicht' } as never)).rejects.toThrow(
      /Unbekannter Passkey/,
    );
  });

  it('Login: Registrierungs-Challenge ist für Login ungültig', async () => {
    const { challengeId } = await startRegistration(h.db, config, user);
    await expect(
      finishLogin(h.db, config, challengeId, { id: 'existing-cred' } as never),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('Login: manipulierte Signatur wird abgelehnt', async () => {
    const challengeId = await saveChallenge(h.db, 'c2', 'login', null);
    const bogus = {
      id: 'existing-cred',
      rawId: 'existing-cred',
      type: 'public-key',
      response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
      clientExtensionResults: {},
    };
    await expect(finishLogin(h.db, config, challengeId, bogus as never)).rejects.toThrow();
  });
});

describe('cookies', () => {
  const fakeCookies = () =>
    ({ set: vi.fn(), delete: vi.fn() }) as unknown as Cookies & {
      set: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };

  it('Session-Cookie: HttpOnly, SameSite=Strict, Secure bei HTTPS', () => {
    const c = fakeCookies();
    const expires = new Date('2030-01-01');
    setSessionCookie(c, config, 'tok', expires);
    expect(c.set).toHaveBeenCalledWith(SESSION_COOKIE, 'tok', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      expires,
    });
  });

  it('kurzlebiges Cookie und Löschen', () => {
    const c = fakeCookies();
    const local = loadConfig({ ORIGIN: 'http://localhost:5173' });
    setShortCookie(c, local, 'x', 'v', 5);
    expect(c.set).toHaveBeenCalledWith('x', 'v', expect.objectContaining({ maxAge: 300, secure: false }));
    clearCookie(c, local, 'x');
    expect(c.delete).toHaveBeenCalledWith('x', expect.objectContaining({ path: '/' }));
  });
});
