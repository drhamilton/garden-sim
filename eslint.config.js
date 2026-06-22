import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Node scripts (e.g. the screenshot harness). Plain JS, so TS doesn't
    // resolve globals for us; declare the node + in-page browser globals the
    // driver uses (the latter inside Playwright `page.evaluate` callbacks).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        document: 'readonly',
        Event: 'readonly',
      },
    },
  },
);
