import { error, json } from '@sveltejs/kit';
import { CHALLENGE_COOKIE, clearCookie, SETUP_COOKIE, setSessionCookie } from '#lib/server/auth/cookies.ts';
import {
  consumeSetupToken,
  countRecoveryCodes,
  createSession,
  isSetupTokenValid,
  regenerateRecoveryCodes,
} from '#lib/server/auth/store.ts';
import { AuthError, finishRegistration } from '#lib/server/auth/webauthn.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

const config = loadConfig();

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
  const { db } = await getDb();
  const challengeId = cookies.get(CHALLENGE_COOKIE);
  clearCookie(cookies, config, CHALLENGE_COOKIE);
  if (!challengeId) error(400, 'Keine offene Registrierung');

  const setupToken = locals.user ? undefined : cookies.get(SETUP_COOKIE);
  if (!locals.user && (!setupToken || !(await isSetupTokenValid(db, setupToken)))) {
    error(401, 'Nicht berechtigt');
  }

  const body = (await request.json()) as { response: unknown; name?: string };
  let userId: string;
  try {
    ({ userId } = await finishRegistration(
      db,
      config,
      challengeId,
      body.response as Parameters<typeof finishRegistration>[3],
      body.name ?? 'Passkey',
    ));
  } catch (e) {
    error(400, e instanceof AuthError ? e.message : 'Registrierung fehlgeschlagen');
  }

  if (setupToken) {
    await consumeSetupToken(db, setupToken);
    clearCookie(cookies, config, SETUP_COOKIE);
    const session = await createSession(db, userId, config.sessionDays);
    setSessionCookie(cookies, config, session.token, session.expiresAt);
  }

  // Beim ersten Passkey (oder wenn keine Codes mehr übrig sind) Recovery-Codes ausgeben – nur dieses eine Mal sichtbar.
  const recoveryCodes =
    (await countRecoveryCodes(db, userId)) === 0 ? await regenerateRecoveryCodes(db, userId) : null;

  return json({ ok: true, recoveryCodes });
};
