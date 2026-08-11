// Binding extra que existe solo en los tests: las migraciones que el setup
// aplica sobre la D1 de Miniflare. Los bindings reales (DB) los genera
// `wrangler types` en worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    MIGRACIONES: import('@cloudflare/vitest-pool-workers').D1Migration[];
  }
}
