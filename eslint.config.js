import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.editorial/**', '.storyops/**', 'articles/**', 'editorial-demo/**', 'storyops-demo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The logger and CLI entry point are the only places allowed to write to the console.
    files: ['src/shared/logger.ts', 'src/cli/**/*.ts', 'tests/**/*.ts', 'fixtures/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
