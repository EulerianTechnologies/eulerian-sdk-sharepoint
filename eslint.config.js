const spfxProfile = require('@microsoft/eslint-config-spfx/lib/flat-profiles/default');

module.exports = [
  // The harness (browser entry, Playwright tests/config) is outside the SPFx
  // TypeScript program, so type-aware rules can't run there. It is type-checked
  // in strict mode by `npm run harness:build` (harness/tsconfig.json) instead.
  { ignores: ['harness/**', 'scripts/**'] },
  ...spfxProfile,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: './tsconfig.json'
      }
    }
  }
];
