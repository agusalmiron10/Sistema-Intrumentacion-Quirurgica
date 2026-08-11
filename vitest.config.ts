import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Los tests corren contra una D1 real sobre Miniflare. Probar los triggers
// contra un mock no verificaria nada: lo que se esta testeando es el
// comportamiento de SQLite.
//
// Ojo: desde la v0.21 del pool no hay aislamiento de storage por test, asi que
// los datos persisten entre tests del mismo archivo. Los helpers de ./test/ayudas
// son idempotentes y cada caso usa ids propios.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { MIGRACIONES: await readD1Migrations(path.join(__dirname, 'migrations')) },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
