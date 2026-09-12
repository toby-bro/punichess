import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dev-dist/', 'public/engine/', 'node_modules/'] },

  js.configs.recommended,
  // Type-aware linting: the rules that actually catch bugs rather than style.
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      // A promise dropped on the floor in the move loop would silently freeze the
      // game, so require every one to be awaited, returned, or explicitly voided.
      '@typescript-eslint/no-floating-promises': 'error',
      // Numbers in template strings are fine and pervasive; everything else
      // still has to be converted deliberately.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Function declarations hoist and are used before their definition all
      // over the game loop, which is fine. Variables do not, and reading one
      // during setup that is declared further down throws at runtime -- twice
      // now. The compiler cannot see it; this can.
      '@typescript-eslint/no-use-before-define': [
        'error',
        { functions: false, classes: true, variables: true, typedefs: false },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },

  // Node-side tooling: scripts and tests may talk to the console.
  {
    files: ['scripts/**', 'src/**/*.test.ts', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  // node:test's describe/it return promises that the runner owns; awaiting them
  // is neither required nor correct, so the floating-promise rule does not apply.
  {
    files: ['src/**/*.test.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  // Plain JavaScript tooling files are not part of the TypeScript program, so
  // the type-aware rules cannot and need not run on them.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
