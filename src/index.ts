import { Hono } from 'hono';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { crearDb, schema } from './db';

/**
 * Fase 1: solo lo minimo para verificar que la base responde.
 * El CRUD de cajas llega en la fase 2 y el endpoint de escaneo en la fase 3.
 */
const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.get('/api/salud', async (c) => {
  const db = crearDb(c.env.DB);
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.transicionValida);
  return c.json({ ok: true, transicionesCargadas: fila?.total ?? 0 });
});

app.get('/api/cajas', async (c) => {
  const db = crearDb(c.env.DB);
  const cajas = await db
    .select()
    .from(schema.caja)
    .orderBy(asc(schema.caja.codigo));
  return c.json(cajas);
});

app.get('/api/cajas/:codigo/historial', async (c) => {
  const db = crearDb(c.env.DB);
  const codigo = c.req.param('codigo').toUpperCase();

  const caja = await db.query.caja.findFirst({ where: eq(schema.caja.codigo, codigo) });
  if (!caja) return c.json({ error: 'caja_inexistente', codigo }, 404);

  const movimientos = await db
    .select()
    .from(schema.movimientoCaja)
    .where(eq(schema.movimientoCaja.cajaId, caja.id))
    .orderBy(desc(schema.movimientoCaja.ocurridoEn));

  return c.json({ caja, movimientos });
});

export default app;
