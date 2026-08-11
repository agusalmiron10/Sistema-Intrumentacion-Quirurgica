import { Hono } from 'hono';

import { crearDb } from '../../db';
import { urlDeCaja } from '../../dominio/identificadores';
import {
  actualizarCaja,
  crearCaja,
  listarCajas,
  obtenerContenido,
  obtenerHistorial,
  reemplazarContenido,
  resolverCaja,
} from '../../servicios/cajas';
import { qrSvg } from '../../servicios/qr';
import { dominioPublico } from '../dominio';
import {
  actualizarCajaSchema,
  crearCajaSchema,
  filtrosCajaSchema,
  reemplazarContenidoSchema,
} from '../esquemas';
import { interpretarErrorD1 } from '../errores';
import { leerJson, leerQuery } from '../validacion';

export const rutasCajas = new Hono<{ Bindings: Cloudflare.Env }>();

const noEncontrada = (ref: string) =>
  ({ error: 'caja_inexistente', mensaje: `No hay ninguna caja con id o codigo "${ref}"` }) as const;

rutasCajas.get('/', async (c) => {
  const filtros = leerQuery(c, filtrosCajaSchema);
  if (!filtros.ok) return filtros.respuesta;

  return c.json(await listarCajas(crearDb(c.env.DB), filtros.datos));
});

rutasCajas.post('/', async (c) => {
  const cuerpo = await leerJson(c, crearCajaSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    const caja = await crearCaja(crearDb(c.env.DB), cuerpo.datos);
    return c.json({ ...caja, url: urlDeCaja(dominioPublico(c), caja.id) }, 201);
  } catch (error) {
    const interpretado = interpretarErrorD1(error);
    if (interpretado) return c.json(interpretado, interpretado.estadoHttp);
    throw error;
  }
});

rutasCajas.get('/:ref', async (c) => {
  const db = crearDb(c.env.DB);
  const ref = c.req.param('ref');

  const caja = await resolverCaja(db, ref);
  if (!caja) return c.json(noEncontrada(ref), 404);

  return c.json({
    ...caja,
    url: urlDeCaja(dominioPublico(c), caja.id),
    contenido: await obtenerContenido(db, caja.id),
  });
});

rutasCajas.patch('/:ref', async (c) => {
  const db = crearDb(c.env.DB);
  const ref = c.req.param('ref');

  const cuerpo = await leerJson(c, actualizarCajaSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const caja = await resolverCaja(db, ref);
  if (!caja) return c.json(noEncontrada(ref), 404);

  try {
    return c.json(await actualizarCaja(db, caja.id, cuerpo.datos));
  } catch (error) {
    const interpretado = interpretarErrorD1(error);
    if (interpretado) return c.json(interpretado, interpretado.estadoHttp);
    throw error;
  }
});

rutasCajas.get('/:ref/historial', async (c) => {
  const db = crearDb(c.env.DB);
  const ref = c.req.param('ref');

  const caja = await resolverCaja(db, ref);
  if (!caja) return c.json(noEncontrada(ref), 404);

  return c.json({ caja, movimientos: await obtenerHistorial(db, caja.id) });
});

rutasCajas.get('/:ref/contenido', async (c) => {
  const db = crearDb(c.env.DB);
  const ref = c.req.param('ref');

  const caja = await resolverCaja(db, ref);
  if (!caja) return c.json(noEncontrada(ref), 404);

  return c.json(await obtenerContenido(db, caja.id));
});

rutasCajas.put('/:ref/contenido', async (c) => {
  const db = crearDb(c.env.DB);
  const ref = c.req.param('ref');

  const cuerpo = await leerJson(c, reemplazarContenidoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const caja = await resolverCaja(db, ref);
  if (!caja) return c.json(noEncontrada(ref), 404);

  try {
    return c.json(await reemplazarContenido(db, caja.id, cuerpo.datos.contenido));
  } catch (error) {
    const interpretado = interpretarErrorD1(error);
    if (interpretado) return c.json(interpretado, interpretado.estadoHttp);
    throw error;
  }
});

rutasCajas.get('/:ref/qr.svg', async (c) => {
  const db = crearDb(c.env.DB);
  const ref = c.req.param('ref');

  const caja = await resolverCaja(db, ref);
  if (!caja) return c.json(noEncontrada(ref), 404);

  const svg = qrSvg(urlDeCaja(dominioPublico(c), caja.id));
  return c.body(svg, 200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  });
});
