import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';

import { crearDb, schema } from '../../db';
import { requiereSesion, type Entorno } from '../middleware';
import { responderError } from '../respuestas';
import { leerJson } from '../validacion';
import {
  crearCirujanoSchema,
  crearProcedimientoSchema,
  crearInstrumentoTipoSchema,
  actualizarCirujanoSchema,
  actualizarProcedimientoSchema,
  actualizarInstrumentoTipoSchema,
} from '../esquemas';

/**
 * Catálogos de solo lectura para la aplicación y endpoints de administración
 * para dar de alta y gestionar cirujanos, procedimientos e instrumentos.
 */
export const rutasCatalogos = new Hono<Entorno>();

// ── Cirujanos ──────────────────────────────────────────────────────────────

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

rutasCatalogos.post('/admin/cirujanos', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (sesion.rol !== 'admin') return c.json({ error: 'rol_insuficiente' }, 403);

  const cuerpo = await leerJson(c, crearCirujanoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    const id = crypto.randomUUID();
    await db.insert(schema.cirujano).values({ id, ...cuerpo.datos });
    return c.json({ id, ...cuerpo.datos }, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasCatalogos.patch('/admin/cirujanos/:id', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (sesion.rol !== 'admin') return c.json({ error: 'rol_insuficiente' }, 403);

  const cuerpo = await leerJson(c, actualizarCirujanoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    await db
      .update(schema.cirujano)
      .set(cuerpo.datos)
      .where(eq(schema.cirujano.id, c.req.param('id')));
    return c.json({ ok: true });
  } catch (error) {
    return responderError(c, error);
  }
});

// ── Procedimientos ─────────────────────────────────────────────────────────

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

rutasCatalogos.post('/admin/procedimientos', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (sesion.rol !== 'admin') return c.json({ error: 'rol_insuficiente' }, 403);

  const cuerpo = await leerJson(c, crearProcedimientoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    const id = crypto.randomUUID();
    await db.insert(schema.procedimiento).values({ id, ...cuerpo.datos });
    return c.json({ id, ...cuerpo.datos }, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasCatalogos.patch('/admin/procedimientos/:id', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (sesion.rol !== 'admin') return c.json({ error: 'rol_insuficiente' }, 403);

  const cuerpo = await leerJson(c, actualizarProcedimientoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    await db
      .update(schema.procedimiento)
      .set(cuerpo.datos)
      .where(eq(schema.procedimiento.id, c.req.param('id')));
    return c.json({ ok: true });
  } catch (error) {
    return responderError(c, error);
  }
});

// ── Tipos de instrumento ───────────────────────────────────────────────────

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

rutasCatalogos.post('/admin/instrumentos', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (sesion.rol !== 'admin') return c.json({ error: 'rol_insuficiente' }, 403);

  const cuerpo = await leerJson(c, crearInstrumentoTipoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    const id = crypto.randomUUID();
    await db.insert(schema.instrumentoTipo).values({ id, ...cuerpo.datos });
    return c.json({ id, ...cuerpo.datos }, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasCatalogos.patch('/admin/instrumentos/:id', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (sesion.rol !== 'admin') return c.json({ error: 'rol_insuficiente' }, 403);

  const cuerpo = await leerJson(c, actualizarInstrumentoTipoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    await db
      .update(schema.instrumentoTipo)
      .set(cuerpo.datos)
      .where(eq(schema.instrumentoTipo.id, c.req.param('id')));
    return c.json({ ok: true });
  } catch (error) {
    return responderError(c, error);
  }
});
