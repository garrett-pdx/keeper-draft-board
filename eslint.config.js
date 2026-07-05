import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'keeper-draft-board.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: { globals: { describe: 'readonly', it: 'readonly', expect: 'readonly' } },
  },
);
