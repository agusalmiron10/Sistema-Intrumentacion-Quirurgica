import { Hono } from 'hono';

import { crearDb } from '../../db';
import {
  agregarCaja,
  cambiarEstado,
  crearCirugia,
  listarCirugias,
  marcarUsada,
  obtenerCirugia,
  quitarCaja,
  trazabilidad,
} from '../../servicios/cirugias';
import { consumirPlanificadoDeCirugia } from '../../servicios/stock';
import {
  cajaDeCirugiaSchema,
  cambiarEstadoCirugiaSchema,
  crearCirugiaSchema,
  filtrosCirugiaSchema,
} from '../esquemas';
import { requiereSesion, type Entorno } from '../middleware';
import { responderError } from '../respuestas';
import { leerJson, leerQuery } from '../validacion';

export const rutasCirugias = new Hono<Entorno>();

rutasCirugias.get('/', async (c) => {
  const filtros = leerQuery(c, filtrosCirugiaSchema);
  if (!filtros.ok) return filtros.respuesta;
  return c.json(await listarCirugias(crearDb(c.env.DB), filtros.datos));
});

/**
 * Crea la cirugia y le copia la plantilla resuelta.
 *
 * Si no hay ninguna plantilla para ese procedimiento se crea igual, pero la
 * respuesta lo dice: es una cirugia sin armado predefinido y alguien tiene que
 * cargarle las cajas a mano.
 */
rutasCirugias.post('/', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, crearCirugiaSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    const resultado = await crearCirugia(crearDb(c.env.DB), cuerpo.datos);
    return c.json(resultado, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasCirugias.get('/:id', async (c) => {
  const cirugia = await obtenerCirugia(crearDb(c.env.DB), c.req.param('id'));
  if (!cirugia) return c.json({ error: 'cirugia_inexistente' }, 404);
  return c.json(cirugia);
});

rutasCirugias.get('/:id/trazabilidad', async (c) => {
  try {
    return c.json(await trazabilidad(crearDb(c.env.DB), c.req.param('id')));
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * Cambia el estado. Pasar a `preparada` asigna las cajas de la plantilla y
 * devuelve cuales no se pudieron: la instrumentadora necesita ver que le falta.
 */
rutasCirugias.post('/:id/estado', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, cambiarEstadoCirugiaSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return c.json(
      await cambiarEstado(
        crearDb(c.env.DB),
        c.get('sesion').usuarioId,
        c.req.param('id'),
        cuerpo.datos.estado,
        cuerpo.datos.ocurridoEn ?? new Date().toISOString(),
      ),
    );
  } catch (error) {
    return responderError(c, error);
  }
});

rutasCirugias.post('/:id/cajas', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, cajaDeCirugiaSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  const id = c.req.param('id');

  try {
    if (cuerpo.datos.usada !== undefined) {
      await marcarUsada(db, id, cuerpo.datos.cajaRef, cuerpo.datos.usada);
    } else {
      await agregarCaja(db, id, cuerpo.datos.cajaRef);
    }
    return c.json(await obtenerCirugia(db, id));
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * Descuenta del stock lo planificado para la cirugia, por FEFO.
 *
 * Cierra la trazabilidad del lado de los descartables: despues de esto se
 * puede responder que numero de lote de sutura se uso en que paciente.
 */
rutasCirugias.post('/:id/consumir', requiereSesion, async (c) => {
  try {
    return c.json(
      await consumirPlanificadoDeCirugia(
        crearDb(c.env.DB),
        c.get('sesion').usuarioId,
        c.req.param('id'),
        new Date().toISOString(),
      ),
    );
  } catch (error) {
    return responderError(c, error);
  }
});

rutasCirugias.delete('/:id/cajas/:ref', requiereSesion, async (c) => {
  const db = crearDb(c.env.DB);
  try {
    await quitarCaja(db, c.req.param('id'), c.req.param('ref'));
    return c.json(await obtenerCirugia(db, c.req.param('id')));
  } catch (error) {
    return responderError(c, error);
  }
});
