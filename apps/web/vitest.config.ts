import { defineProject } from 'vitest/config';

// Unit-Tests für Server-Logik in src/lib/server – ohne SvelteKit-Plugin.
export default defineProject({
  test: { name: 'web', include: ['src/**/*.test.ts'], testTimeout: 30_000 },
});
