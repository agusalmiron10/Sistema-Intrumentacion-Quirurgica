import { applyD1Migrations, env } from 'cloudflare:test';

// Se aplica una sola vez, antes de todos los tests. El aislamiento por test
// lo da `isolatedStorage` del pool: cada test arranca de este estado.
await applyD1Migrations(env.DB, env.MIGRACIONES);
