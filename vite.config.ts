import { defineConfig } from 'vitest/config';

// Static, no-backend app. `base` is relative so the built site works both at a
// domain root and under a GitHub Pages project subpath (/<repo>/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
