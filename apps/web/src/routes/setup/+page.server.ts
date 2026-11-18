import { redirect } from '@sveltejs/kit';
import { SETUP_COOKIE, setShortCookie } from '#lib/server/auth/cookies.ts';
import { isSetupTokenValid } from '#lib/server/auth/store.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

const config = loadConfig();

export const load: PageServerLoad = async ({ url, cookies }) => {
  const { db } = await getDb();
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    // Token aus der URL in ein HttpOnly-Cookie übernehmen und aus der Adresszeile/History entfernen.
    if (await isSetupTokenValid(db, fromUrl)) setShortCookie(cookies, config, SETUP_COOKIE, fromUrl, 15);
    redirect(303, '/setup');
  }
  const token = cookies.get(SETUP_COOKIE);
  return { valid: Boolean(token && (await isSetupTokenValid(db, token))) };
};
