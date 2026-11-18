import { error, json } from '@sveltejs/kit';
import { CHALLENGE_COOKIE, clearCookie, setSessionCookie } from '#lib/server/auth/cookies.ts';
import { createSession } from '#lib/server/auth/store.ts';
import { AuthError, finishLogin } from '#lib/server/auth/webauthn.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { authLimiter } from '#lib/server/ratelimit.ts';
import type { RequestHandler } from './$types';

const config = loadConfig();

export const POST: RequestHandler = async ({ cookies, request, getClientAddress }) => {
  if (!authLimiter.take(`login:${getClientAddress()}`)) error(429, 'Zu viele Versuche – bitte kurz warten');
  const challengeId = cookies.get(CHALLENGE_COOKIE);
  clearCookie(cookies, config, CHALLENGE_COOKIE);
  if (!challengeId) error(400, 'Keine offene Anmeldung');

  const { db } = await getDb();
  const body = (await request.json()) as { response: unknown };
  let userId: string;
  try {
    ({ userId } = await finishLogin(
      db,
      config,
      challengeId,
      body.response as Parameters<typeof finishLogin>[3],
    ));
  } catch (e) {
    error(401, e instanceof AuthError ? e.message : 'Anmeldung fehlgeschlagen');
  }
  const session = await createSession(db, userId, config.sessionDays);
  setSessionCookie(cookies, config, session.token, session.expiresAt);
  return json({ ok: true });
};
