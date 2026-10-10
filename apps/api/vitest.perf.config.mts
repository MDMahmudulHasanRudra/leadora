import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Load tests (spec §68). Not part of `pnpm test`: run on demand with `pnpm test:perf`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/perf/**/*.perf.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/setup-env.ts'],
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
