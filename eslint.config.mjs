import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.pnpm-store*/**',
      '**/dist/**',
      '**/.angular/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    },
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
);
