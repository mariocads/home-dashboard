import {
  deleteInstallment,
  deleteInvoice,
  deleteTariff,
  importTariffData,
  saveInstallment,
  saveInvoice,
  saveTariff,
} from '@hd/db';
import {
  parseInstallment,
  parseInvoice,
  parseTariffComponent,
  parseTariffData,
  type TariffComponent,
  TariffInputError,
} from '@hd/domain';
import { fail } from '@sveltejs/kit';
import { formId, formRecord, loadTariffAdmin, tariffInputFromForm } from '#lib/server/costs.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

const MAX_JSON_BYTES = 1024 * 1024;

type Scope = 'tariff' | 'installment' | 'invoice' | 'import';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  return loadTariffAdmin(db);
};

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur; cur = (cur as { cause?: unknown }).cause) {
    if ((cur as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

function failWith(scope: Scope, e: unknown) {
  if (e instanceof TariffInputError) return fail(400, { scope, error: e.message });
  if (isUniqueViolation(e))
    return fail(400, { scope, error: 'Diesen Eintrag gibt es schon (gleicher Empfänger und Beginn).' });
  throw e;
}

const toRow = (c: TariffComponent) => ({
  payee: c.payee,
  category: c.category,
  name: c.name,
  unit: c.unit,
  priceNet: c.priceNet,
  vatPct: c.vatPct,
  validFrom: c.validFrom,
  validTo: c.validTo,
  window: c.window,
  note: c.note ?? null,
});

async function remove(request: Request, del: (id: number) => Promise<void>) {
  const id = formId(await request.formData());
  if (id) await del(id);
  return { deleted: true };
}

export const actions: Actions = {
  saveTariff: async ({ request }) => {
    const fd = await request.formData();
    const { db } = await getDb();
    try {
      await saveTariff(db, toRow(parseTariffComponent(tariffInputFromForm(fd))), formId(fd));
    } catch (e) {
      return failWith('tariff', e);
    }
    return { scope: 'tariff' as Scope, saved: true };
  },

  deleteTariff: async ({ request }) => {
    const { db } = await getDb();
    return remove(request, (id) => deleteTariff(db, id));
  },

  saveInstallment: async ({ request }) => {
    const fd = await request.formData();
    const { db } = await getDb();
    try {
      await saveInstallment(db, parseInstallment(formRecord(fd)), formId(fd));
    } catch (e) {
      return failWith('installment', e);
    }
    return { scope: 'installment' as Scope, saved: true };
  },

  deleteInstallment: async ({ request }) => {
    const { db } = await getDb();
    return remove(request, (id) => deleteInstallment(db, id));
  },

  saveInvoice: async ({ request }) => {
    const fd = await request.formData();
    const { db } = await getDb();
    try {
      const inv = parseInvoice(formRecord(fd));
      await saveInvoice(db, { ...inv, note: inv.note ?? null }, formId(fd));
    } catch (e) {
      return failWith('invoice', e);
    }
    return { scope: 'invoice' as Scope, saved: true };
  },

  deleteInvoice: async ({ request }) => {
    const { db } = await getDb();
    return remove(request, (id) => deleteInvoice(db, id));
  },

  importJson: async ({ request }) => {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { scope: 'import' as Scope, error: 'Bitte eine JSON-Datei auswählen.' });
    if (file.size > MAX_JSON_BYTES)
      return fail(400, { scope: 'import' as Scope, error: 'Die Datei ist zu groß (maximal 1 MB).' });
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return fail(400, { scope: 'import' as Scope, error: 'Keine gültige JSON-Datei.' });
    }
    const { db } = await getDb();
    try {
      const data = parseTariffData(raw);
      const counts = await importTariffData(db, {
        tariffs: data.tariffs.map(toRow),
        installments: data.installments,
        invoices: data.invoices.map((i) => ({ ...i, note: i.note ?? null })),
      });
      return { scope: 'import' as Scope, imported: counts };
    } catch (e) {
      return failWith('import', e);
    }
  },
};
