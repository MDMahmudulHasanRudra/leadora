import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 30_000,
  },
  // esbuild cannot emit decorator metadata, which Nest DI relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
