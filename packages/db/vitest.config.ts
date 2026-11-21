import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // In CI teilen sich alle Dateien eine TimescaleDB: Migrationen dürfen nicht parallel laufen.
    fileParallelism: false,
  },
});
