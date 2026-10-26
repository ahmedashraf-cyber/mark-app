// ESLint (flat config). Introduced with the audit follow-up; deliberately NOT a style crusade:
//   error → things that are bugs or break the build (undefined names, hook-order violations, dupes)
//   warn  → real but pre-existing smells, kept visible as a backlog (unused vars, empty catches, hook deps)
// Nothing here is formatting; there is no Prettier config.
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'dist/**', 'node_modules/**',
      'src-tauri/**',                       // Rust, plus bridge_script.js which runs inside ANOTHER app (own globals) — lint separately
      'docs/**',
      'src/utils/modelImportData.js',       // 48k lines of generated data
      // TEMPORARY: the parser cannot read this file because of an orphaned `)}` in the Done modal
      // (FieldPage.jsx ~line 2439; esbuild tolerates it, the UI prints a literal ")}"). Fixing it changes
      // what users see, so it is waiting for an owner decision — re-enable linting here once it is fixed.
      'src/pages/FieldPage.jsx',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      // JSX counts as "using" a component, and an undefined component is an error
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      // hooks: the classic two only (the plugin's newer compiler-oriented rules are not adopted here)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // pre-existing, visible, not blocking
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
      'no-fallthrough': 'warn',
      'no-cond-assign': ['warn', 'except-parens'],
      'no-inner-declarations': 'off',       // function declarations inside components are the house style
    },
  },
  {
    // Node-side files: scripts, test scripts, configs
    files: ['scripts/**/*.{js,mjs}', 'src/**/*.test.mjs', 'src/**/*.parity.mjs', '*.config.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] },
  },
  {
    // A proof script that is pasted into / run inside a browser page, not Node
    files: ['scripts/eventhistory-sweep-proof.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // sync-version.js is CommonJS
    files: ['scripts/sync-version.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
]
