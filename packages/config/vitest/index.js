// Shared Vitest presets.
//   unit:        `*.test.ts`, no network, no database.
//   integration: `*.int.test.ts`, real Postgres (Testcontainers locally, a service container in CI).

/** @type {import('vitest/config').ViteUserConfig} */
export const unitConfig = {
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
    passWithNoTests: false,
    restoreMocks: true,
  },
};

/** @type {import('vitest/config').ViteUserConfig} */
export const integrationConfig = {
  test: {
    include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    restoreMocks: true,
  },
};
