import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // No `any`, no silent ts-comment escapes (a written reason is mandatory).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      // Functional style: classes are allowed ONLY in apps/api (NestJS). See override below.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ClassDeclaration',
          message: 'Classes are allowed only in apps/api (NestJS). Use functions and plain data.',
        },
        {
          selector: 'ClassExpression',
          message: 'Classes are allowed only in apps/api (NestJS). Use functions and plain data.',
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
