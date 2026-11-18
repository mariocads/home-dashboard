import { error, json } from '@sveltejs/kit';
import { CHALLENGE_COOKIE, setShortCookie } from '#lib/server/auth/cookies.ts';
import { startLogin } from '#lib/server/auth/webauthn.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { authLimiter } from '#lib/server/ratelimit.ts';
import type { RequestHandler } from './$types';

const config = loadConfig();

export const POST: RequestHandler = async ({ cookies, getClientAddress }) => {
  if (!authLimiter.take(`login:${getClientAddress()}`)) error(429, 'Zu viele Versuche – bitte kurz warten');
  const { db } = await getDb();
  const { options, challengeId } = await startLogin(db, config);
  setShortCookie(cookies, config, CHALLENGE_COOKIE, challengeId, 5);
  return json(options);
};
