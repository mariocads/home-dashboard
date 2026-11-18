export { createDb, type Db, type DbHandle, type Schema } from './client.ts';
export { runMigrations } from './migrate.ts';
export {
  ensureMeter,
  getSetting,
  insertReadings,
  latestReading,
  type MeterDefinition,
  type NewReading,
  setSetting,
} from './repo.ts';
export * as schema from './schema.ts';
