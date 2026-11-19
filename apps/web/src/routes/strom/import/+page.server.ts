import { listImports } from '@hd/db';
import { NetzOoeCsvError } from '@hd/domain';
import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { MAX_UPLOAD_BYTES, previewImport, runImport } from '#lib/server/netzooe-import.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  const imports = await listImports(db);
  return {
    imports: imports.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      from: i.fromTs?.toISOString() ?? null,
      to: i.toTs?.toISOString() ?? null,
      rowCount: i.rowCount,
      inserted: i.inserted,
      updated: i.updated,
      unchanged: i.unchanged,
      issueCount: i.issueCount,
      gapCount: i.gapCount,
      totalKwh: i.totalKwh,
    })),
  };
};

async function readUpload(request: Request): Promise<string | { error: string }> {
  const file = (await request.formData()).get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Bitte eine CSV-Datei auswählen.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Die Datei ist zu groß (maximal 20 MB).' };
  return file.text();
}

function failParse(e: unknown) {
  if (e instanceof NetzOoeCsvError) return fail(400, { error: e.message });
  throw e;
}

export const actions: Actions = {
  preview: async ({ request }) => {
    const text = await readUpload(request);
    if (typeof text !== 'string') return fail(400, text);
    const { db } = await getDb();
    try {
      return { preview: await previewImport(db, text) };
    } catch (e) {
      return failParse(e);
    }
  },

  import: async ({ request }) => {
    const text = await readUpload(request);
    if (typeof text !== 'string') return fail(400, text);
    const { db } = await getDb();
    try {
      const record = await runImport(db, text);
      return {
        imported: { inserted: record.inserted, updated: record.updated, unchanged: record.unchanged },
      };
    } catch (e) {
      return failParse(e);
    }
  },
};
