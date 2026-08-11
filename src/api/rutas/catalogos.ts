import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';

import { crearDb, schema } from '../../db';
import type { Entorno } from '../middleware';

/**
 * Catalogos de solo lectura: lo que hace falta para poblar los selectores de
 * la aplicacion (cirujanos, procedimientos, tipos de instrumental).
 */
export const rutasCatalogos = new Hono<Entorno>();

rutasCatalogos.get('/cirujanos', async (c) => {
  const db = crearDb(c.env.DB);
  return c.json(
    await db
      .select()
      .from(schema.cirujano)
      .where(eq(schema.cirujano.activo, 1))
      .orderBy(asc(schema.cirujano.nombre)),
  );
});

rutasCatalogos.get('/procedimientos', async (c) => {
  const db = crearDb(c.env.DB);
  return c.json(
    await db
      .select()
      .from(schema.procedimiento)
      .where(eq(schema.procedimiento.activo, 1))
      .orderBy(asc(schema.procedimiento.nombre)),
  );
});

rutasCatalogos.get('/instrumentos', async (c) => {
  const db = crearDb(c.env.DB);
  return c.json(
    await db
      .select()
      .from(schema.instrumentoTipo)
      .where(eq(schema.instrumentoTipo.activo, 1))
      .orderBy(asc(schema.instrumentoTipo.nombre)),
  );
});
