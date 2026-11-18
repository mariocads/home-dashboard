import { fail, redirect } from '@sveltejs/kit';
import { clearCookie, SESSION_COOKIE } from '#lib/server/auth/cookies.ts';
import {
  countRecoveryCodes,
  deletePasskey,
  deleteSession,
  listPasskeys,
  regenerateRecoveryCodes,
} from '#lib/server/auth/store.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

const config = loadConfig();

export const load: PageServerLoad = async ({ locals, url }) => {
  const { db } = await getDb();
  const user = locals.user!;
  const passkeys = await listPasskeys(db, user.id);
  return {
    recovered: url.searchParams.has('recovered'),
    recoveryCodesLeft: await countRecoveryCodes(db, user.id),
    passkeys: passkeys.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      synced: p.backedUp,
    })),
  };
};

export const actions: Actions = {
  logout: async ({ locals, cookies }) => {
    const { db } = await getDb();
    if (locals.sessionId) await deleteSession(db, locals.sessionId);
    clearCookie(cookies, config, SESSION_COOKIE);
    redirect(303, '/login');
  },

  deletePasskey: async ({ locals, request }) => {
    const id = String((await request.formData()).get('id') ?? '');
    const { db } = await getDb();
    try {
      await deletePasskey(db, locals.user!.id, id);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { deleted: true };
  },

  regenerateCodes: async ({ locals }) => {
    const { db } = await getDb();
    return { codes: await regenerateRecoveryCodes(db, locals.user!.id) };
  },
};
