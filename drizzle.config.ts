import { defineConfig } from 'drizzle-kit';

// Solo generamos SQL: la aplicacion de migraciones la hace
// `wrangler d1 migrations apply`, que lee la carpeta ./migrations.
//
// Convencion de numeracion (ver README):
//   0000-0499 -> migraciones generadas por drizzle-kit (DDL de tablas)
//   0500+     -> migraciones escritas a mano (triggers, datos de catalogo)
// Drizzle numera segun su propio meta/_journal.json, asi que nunca colisiona
// con la banda manual.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  casing: 'snake_case',
});
