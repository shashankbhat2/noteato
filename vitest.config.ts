import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Main-process modules import `electron` for `app.getPath` and friends.
      // Unit tests only reach the pure logic around that, so the module is
      // stubbed rather than the tests being confined to files that avoid it.
      electron: resolve(__dirname, 'test/stubs/electron.ts'),
      // A native addon built against Electron's ABI; it cannot load in plain
      // Node. See the stub for what it does and does not pretend to be.
      'better-sqlite3': resolve(__dirname, 'test/stubs/better-sqlite3.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
