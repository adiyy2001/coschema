import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nondeterminismBan = [
  {
    object: 'Math',
    property: 'random',
    message: 'Take a RandomSource as a parameter instead.',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'Take a clock as a parameter instead.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.angular/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Take a clock as a parameter instead.',
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['packages/model/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nondeterminismBan],
    },
  },
  {
    files: ['scripts/**/*.ts', 'packages/*/test/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
