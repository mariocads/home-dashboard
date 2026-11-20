import { latestReading, setSetting } from '@hd/db';
import {
  AMIS_POLL_INTERVAL,
  ISG_POLL_INTERVAL,
  parseIntegerSetting,
  WP_METER,
  WP_QUANTITY,
} from '@hd/domain';
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
import {
  getAmisInterval,
  getAmisStatus,
  getIsgInterval,
  getIsgStatus,
  getLivePower,
} from '#lib/server/live.ts';
import type { Actions, PageServerLoad } from './$types';

const config = loadConfig();

export const load: PageServerLoad = async ({ locals, url }) => {
  const { db } = await getDb();
  const user = locals.user!;
  const [passkeys, amisInterval, power, amisStatus, isgInterval, isgLast, isgStatus] = await Promise.all([
    listPasskeys(db, user.id),
    getAmisInterval(db),
    getLivePower(db),
    getAmisStatus(db),
    getIsgInterval(db),
    latestReading(db, WP_METER.slug, WP_QUANTITY.outdoorC),
    getIsgStatus(db),
  ]);
  return {
    amis: {
      interval: amisInterval,
      min: AMIS_POLL_INTERVAL.min,
      max: AMIS_POLL_INTERVAL.max,
      lastValueAt: power?.ts ?? null,
      status: amisStatus,
    },
    isg: {
      interval: isgInterval,
      min: ISG_POLL_INTERVAL.min,
      max: ISG_POLL_INTERVAL.max,
      lastValueAt: isgLast?.ts.toISOString() ?? null,
      status: isgStatus,
    },
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

  saveAmisInterval: async ({ request }) => {
    const parsed = parseIntegerSetting(AMIS_POLL_INTERVAL, (await request.formData()).get('interval'));
    if (!parsed.ok) return fail(400, { amisError: parsed.error });
    const { db } = await getDb();
    await setSetting(db, AMIS_POLL_INTERVAL.key, parsed.value);
    return { amisSaved: true };
  },

  saveIsgInterval: async ({ request }) => {
    const parsed = parseIntegerSetting(ISG_POLL_INTERVAL, (await request.formData()).get('interval'));
    if (!parsed.ok) return fail(400, { isgError: parsed.error });
    const { db } = await getDb();
    await setSetting(db, ISG_POLL_INTERVAL.key, parsed.value);
    return { isgSaved: true };
  },

  regenerateCodes: async ({ locals }) => {
    const { db } = await getDb();
    return { codes: await regenerateRecoveryCodes(db, locals.user!.id) };
  },
};
