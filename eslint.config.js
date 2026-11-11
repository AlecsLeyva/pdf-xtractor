import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/libarchive/**',
      'tests/output/**',
      'tests/fixtures/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'workers/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', 'scripts/**/*.mjs', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        AbortController: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['tests/e2e.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
