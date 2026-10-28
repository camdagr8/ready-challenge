import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Sets the global Hook, as src/index.ts does for the server
    setupFiles: ['test/setup.ts'],
    // Each test gets a clean process.env and fresh mocks
    unstubEnvs: true,
    restoreMocks: true,
  },
});
