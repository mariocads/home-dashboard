import { error, json } from '@sveltejs/kit';
import { CHALLENGE_COOKIE, SETUP_COOKIE, setShortCookie } from '#lib/server/auth/cookies.ts';
import { getOrCreateAdmin, isSetupTokenValid } from '#lib/server/auth/store.ts';
import { startRegistration } from '#lib/server/auth/webauthn.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

const config = loadConfig();

/** Registrierung erlaubt mit Session (weiterer Passkey) oder gültigem Setup-Token (Ersteinrichtung/Notfall). */
export const POST: RequestHandler = async ({ locals, cookies }) => {
  const { db } = await getDb();
  let user = locals.user;
  if (!user) {
    const setupToken = cookies.get(SETUP_COOKIE);
    if (!setupToken || !(await isSetupTokenValid(db, setupToken))) error(401, 'Nicht berechtigt');
    const admin = await getOrCreateAdmin(db);
    user = { id: admin.id, username: admin.username };
  }
  const { options, challengeId } = await startRegistration(db, config, user);
  setShortCookie(cookies, config, CHALLENGE_COOKIE, challengeId, 5);
  return json(options);
};
