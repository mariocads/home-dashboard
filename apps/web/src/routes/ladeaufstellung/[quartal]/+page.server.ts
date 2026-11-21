import {
  approveChargeReport,
  reopenChargeReport,
  requestChargeRefresh,
  requestChargeTestMail,
  skipChargeReport,
} from '@hd/db';
import { error, fail } from '@sveltejs/kit';
import { loadChargeReport } from '#lib/server/charge-report.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const { db } = await getDb();
  const report = await loadChargeReport(db, params.quartal);
  if (!report) error(404, 'Keine Lade-Aufstellung für dieses Quartal');
  return { report };
};

export const actions: Actions = {
  /** Freigabe gilt nur für den angezeigten Export (Hash aus dem Formular). */
  approve: async ({ params, request }) => {
    const sha = String((await request.formData()).get('sha256') ?? '');
    const { db } = await getDb();
    const report = await loadChargeReport(db, params.quartal);
    if (!report?.mail.to)
      return fail(400, { error: 'Zuerst in den Einstellungen einen Empfänger eintragen.' });
    if (report.mailStatus.state !== 'ready')
      return fail(400, { error: `Mailversand: ${report.mailStatus.hint}` });
    if (!(await approveChargeReport(db, params.quartal, sha))) {
      return fail(409, {
        error: 'Der Export hat sich geändert oder ist schon freigegeben. Bitte neu prüfen.',
      });
    }
    return { approved: true };
  },

  refresh: async ({ params }) => {
    const { db } = await getDb();
    if (!(await requestChargeRefresh(db, params.quartal)))
      return fail(409, { error: 'Jetzt nicht möglich.' });
    return { refreshing: true };
  },

  test: async ({ params }) => {
    const { db } = await getDb();
    if (!(await requestChargeTestMail(db, params.quartal)))
      return fail(409, { error: 'Noch kein Export vorhanden.' });
    return { testing: true };
  },

  skip: async ({ params }) => {
    const { db } = await getDb();
    if (!(await skipChargeReport(db, params.quartal))) return fail(409, { error: 'Jetzt nicht möglich.' });
    return { skipped: true };
  },

  reopen: async ({ params }) => {
    const { db } = await getDb();
    if (!(await reopenChargeReport(db, params.quartal))) return fail(409, { error: 'Jetzt nicht möglich.' });
    return { reopened: true };
  },
};
