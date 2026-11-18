import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/collector',
      'apps/web',
      { test: { name: 'scripts', include: ['scripts/**/*.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Einstiegspunkte und Browser-Code werden über Playwright (E2E) bzw. den TimescaleDB-Job abgedeckt.
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/migrations/**',
        'apps/web/src/routes/**',
        'apps/web/src/hooks.server.ts',
        'apps/web/src/lib/passkey.ts',
        'apps/web/src/lib/server/db.ts',
        'apps/collector/src/main.ts',
        'packages/db/src/migrate-cli.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        // Rechenlogik: hoher Anspruch
        'packages/domain/src/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
        // Gesamt
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
