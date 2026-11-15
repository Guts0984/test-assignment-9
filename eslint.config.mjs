import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/next-env.d.ts',
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
  // ---- apps/web: React rules + Feature-Sliced Design import boundaries -------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, boundaries },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['apps/web/src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/web/src/app', mode: 'folder' },
        { type: 'pages', pattern: 'apps/web/src/pages/*', mode: 'folder', capture: ['slice'] },
        { type: 'widgets', pattern: 'apps/web/src/widgets/*', mode: 'folder', capture: ['slice'] },
        {
          type: 'features',
          pattern: 'apps/web/src/features/*',
          mode: 'folder',
          capture: ['slice'],
        },
        {
          type: 'entities',
          pattern: 'apps/web/src/entities/*',
          mode: 'folder',
          capture: ['slice'],
        },
        { type: 'shared', pattern: 'apps/web/src/shared', mode: 'folder' },
      ],
      'import/resolver': { typescript: { project: 'apps/web/tsconfig.json' } },
    },
    rules: {
      // FSD: a module may only import from layers BELOW it, never from a sibling slice or a layer above.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'app', allow: ['pages', 'widgets', 'features', 'entities', 'shared'] },
            { from: 'pages', allow: ['widgets', 'features', 'entities', 'shared'] },
            { from: 'widgets', allow: ['features', 'entities', 'shared'] },
            { from: 'features', allow: ['entities', 'shared'] },
            { from: 'entities', allow: ['shared'] },
            { from: 'shared', allow: [] },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
