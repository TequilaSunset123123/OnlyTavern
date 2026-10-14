// Trimmed from Fastt's vitest.config.ts. Data-layer tests run in Node; UI tests
// (jsdom + Testing Library) get added when the first one lands.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
