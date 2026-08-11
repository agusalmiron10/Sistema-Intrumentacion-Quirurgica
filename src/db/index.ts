import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

export type Db = ReturnType<typeof crearDb>;

export function crearDb(d1: D1Database) {
  return drizzle(d1, { schema, casing: 'snake_case' });
}

export { schema };
