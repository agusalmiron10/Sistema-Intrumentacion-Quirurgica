import { Hono } from 'hono';

import { crearDb } from '../../db';
import {
  crearVersion,
  darDeBaja,
  listarPlantillas,
  obtenerPlantilla,
  resolverPlantilla,
  usosDePlantilla,
} from '../../servicios/plantillas';
import { crearPlantillaSchema, filtrosPlantillaSchema } from '../esquemas';
import { requiereSesion, type Entorno } from '../middleware';
import { responderError } from '../respuestas';
import { leerJson, leerQuery } from '../validacion';

export const rutasPlantillas = new Hono<Entorno>();

rutasPlantillas.get('/', async (c) => {
  const filtros = leerQuery(c, filtrosPlantillaSchema);
  if (!filtros.ok) return filtros.respuesta;
  return c.json(await listarPlantillas(crearDb(c.env.DB), filtros.datos));
});

/**
 * Que plantilla se aplicaria a esta combinacion.
 *
 * Se expone aparte porque la instrumentadora necesita poder consultarlo antes
 * de crear la cirugia: ver que armado le va a tocar y si sale la del cirujano
 * o la generica del servicio.
 */
rutasPlantillas.get('/resolver', async (c) => {
  const procedimientoId = c.req.query('procedimientoId');
  const cirujanoId = c.req.query('cirujanoId');
  if (!procedimientoId || !cirujanoId) {
    return c.json(
      { error: 'validacion', mensaje: 'Hacen falta procedimientoId y cirujanoId' },
      400,
    );
  }

  const db = crearDb(c.env.DB);
  const plantilla = await resolverPlantilla(db, procedimientoId, cirujanoId);
  if (!plantilla) {
    return c.json({ encontrada: false, plantilla: null, origen: null });
  }

  return c.json({
    encontrada: true,
    origen: plantilla.cirujanoId ? 'cirujano' : 'generica',
    plantilla: await obtenerPlantilla(db, plantilla.id),
  });
});

rutasPlantillas.get('/:id', async (c) => {
  const db = crearDb(c.env.DB);
  const plantilla = await obtenerPlantilla(db, c.req.param('id'));
  if (!plantilla) return c.json({ error: 'plantilla_inexistente' }, 404);

  return c.json({ ...plantilla, usos: await usosDePlantilla(db, plantilla.id) });
});

/**
 * Crea una version nueva. Las plantillas no se editan en el lugar: la anterior
 * queda como historico porque las cirugias viejas la referencian.
 */
rutasPlantillas.post('/', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, crearPlantillaSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return c.json(await crearVersion(crearDb(c.env.DB), cuerpo.datos), 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasPlantillas.post('/:id/dar-de-baja', requiereSesion, async (c) => {
  try {
    await darDeBaja(crearDb(c.env.DB), c.req.param('id'));
    return c.json({ ok: true });
  } catch (error) {
    return responderError(c, error);
  }
});
