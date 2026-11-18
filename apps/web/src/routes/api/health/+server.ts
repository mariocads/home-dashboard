import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const { db } = await getDb();
    await db.execute(sql`select 1`);
    return json({ status: 'ok' });
  } catch (e) {
    console.error('Healthcheck fehlgeschlagen', e);
    return json({ status: 'error' }, { status: 503 });
  }
};
