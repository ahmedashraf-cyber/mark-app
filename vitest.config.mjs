import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit and component tests (jsdom). The two older script-style tests (*.test.mjs / *.parity.mjs)
// are run by scripts/run-tests.mjs, so they are deliberately not matched here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['src/test/setup.js'],
    restoreMocks: true,
    testTimeout: 20000,
    // the app's own diagnostic lines ('[MARK] ...') are noise in test output
    onConsoleLog: log => (/^\[(MARK|DRILL)/.test(log) ? false : undefined),
  },
})
