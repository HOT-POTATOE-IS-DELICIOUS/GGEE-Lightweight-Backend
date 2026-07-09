import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'eslint.config.mjs', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      // projectService type-checks src and test from their tsconfigs, which is what makes the
      // no-floating-promises / no-misused-promises rules below able to see async signatures.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Decorator metadata and TypeORM entities lean on parameter properties and empty ctors.
      '@typescript-eslint/no-extraneous-class': 'off',
      // A fire-and-forget promise must be marked `void`, never left dangling.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Test doubles are built from plain objects and `as unknown as T`, mock implementations are
    // declared `async` to match a promise-returning signature without ever awaiting, and helpers
    // deliberately throw non-Error values to exercise error paths. None of that is a defect here,
    // but all of it is in production code — so these are relaxed for specs only.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  prettier,
);
