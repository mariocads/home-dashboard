import { loadChargeTodos } from '#lib/server/charge-report.ts';
import { loadCostTile } from '#lib/server/costs.ts';
import { getDb } from '#lib/server/db.ts';
import { loadOverview } from '#lib/server/energy.ts';
import { loadHeatPumpTile } from '#lib/server/heatpump.ts';
import { getLivePower } from '#lib/server/live.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  const [power, overview, cost, heatPump, todos] = await Promise.all([
    getLivePower(db),
    loadOverview(db),
    loadCostTile(db),
    loadHeatPumpTile(db),
    loadChargeTodos(db),
  ]);
  return { power, overview, cost, heatPump, todos };
};
