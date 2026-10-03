import js from '@eslint/js';
import angular from 'angular-eslint';
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
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: config.files ?? ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
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
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
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
    files: ['apps/editor/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: ['element', 'attribute'], prefix: 'cs', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'cs', style: 'camelCase' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['apps/editor/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  {
    files: ['apps/editor/src/main.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      'packages/model/src/**/*.ts',
      'packages/geometry/src/**/*.ts',
      'packages/sync/src/**/*.ts',
      'packages/sim/src/**/*.ts',
    ],
    ignores: ['packages/sim/src/cli.ts', 'packages/sim/src/report.ts', 'packages/sim/src/bin.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nondeterminismBan],
    },
  },
  {
    files: ['packages/sync/src/**/*.ts', 'packages/sim/src/link/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^node:',
              message: 'This code also runs in the browser and must not use Node built-ins.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/rooms/**/*.ts', 'apps/server/src/persistence/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nondeterminismBan],
    },
  },
  {
    files: [
      'apps/server/src/main.ts',
      'apps/server/src/server.ts',
      'apps/*/test/**/*.ts',
      'bench/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts', 'packages/*/test/**/*.ts', 'apps/*/test/**/*.ts', 'bench/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
