import { defineConfig } from 'vitest/config';

// Local dev/build serve from root ('/'). The GitHub Pages deploy workflow sets
// GITHUB_PAGES=true so the production build emits asset URLs rooted at the
// project subpath (https://garrett-pdx.github.io/keeper-draft-board/).
const isGhPages = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  base: isGhPages ? '/keeper-draft-board/' : '/',
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
