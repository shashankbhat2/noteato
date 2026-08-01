import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Main-process modules import `electron` for `app.getPath` and friends.
      // Unit tests only reach the pure logic around that, so the module is
      // stubbed rather than the tests being confined to files that avoid it.
      electron: resolve(__dirname, 'test/stubs/electron.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
