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
        bindings: {
          MIGRACIONES: await readD1Migrations(path.join(__dirname, 'migrations')),
          // El secreto de los tests vive aca y no en wrangler.toml: en
          // Cloudflare las vars y los secrets comparten namespace, asi que
          // declararlo en la config del Worker haria que cada deploy pisara el
          // secreto real de produccion con el valor del archivo.
          SESION_SECRET: 'secreto-de-tests-sin-valor-fuera-de-vitest',
          // Vacio a proposito: asi los tests ejercitan el fallback al origen
          // del request y no se rompen cada vez que cambia el dominio del
          // despliegue, que no tiene nada que ver con lo que estan probando.
          DOMINIO_PUBLICO: '',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
