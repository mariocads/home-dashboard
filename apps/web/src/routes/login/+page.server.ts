import { fail, redirect } from '@sveltejs/kit';
import { setSessionCookie } from '#lib/server/auth/cookies.ts';
import { consumeRecoveryCode, createSession, findAdmin, listPasskeys } from '#lib/server/auth/store.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { authLimiter } from '#lib/server/ratelimit.ts';
import type { Actions, PageServerLoad } from './$types';

const config = loadConfig();

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, '/');
  const { db } = await getDb();
  const admin = await findAdmin(db);
  return { initialized: admin !== null && (await listPasskeys(db, admin.id)).length > 0 };
};

export const actions: Actions = {
  recovery: async ({ request, cookies, getClientAddress }) => {
    if (!authLimiter.take(`recovery:${getClientAddress()}`)) {
      return fail(429, { error: 'Zu viele Versuche – bitte kurz warten.' });
    }
    const code = String((await request.formData()).get('code') ?? '');
    const { db } = await getDb();
    const userId = await consumeRecoveryCode(db, code);
    if (!userId) return fail(400, { error: 'Code ungültig oder bereits verwendet.' });
    const session = await createSession(db, userId, config.sessionDays);
    setSessionCookie(cookies, config, session.token, session.expiresAt);
    redirect(303, '/einstellungen?recovered=1');
  },
};
