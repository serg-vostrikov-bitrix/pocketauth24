import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'drizzle',
      'node_modules',
      'web',
      '.agents',
      '.claude',
      '.codex',
      '.comet',
      '.superpowers',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Fastify handlers and method handlers are async by convention.
      '@typescript-eslint/require-await': 'off',
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a string literal union, not enum.' },
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
      ],
    },
  },
  { files: ['*.config.ts', '*.config.js'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
  prettier,
);
