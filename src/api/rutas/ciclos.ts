import { Hono, type Context } from 'hono';
import { asc, eq } from 'drizzle-orm';

import { crearDb, schema } from '../../db';
import {
  cajasDelCiclo,
  cargarControles,
  crearCiclo,
  ErrorCiclo,
  finalizarCiclo,
  impactoDeCiclo,
  liberarCiclo,
  listarCiclos,
  obtenerCiclo,
} from '../../servicios/ciclos';
import { interpretarErrorD1 } from '../errores';
import {
  controlesSchema,
  crearCicloSchema,
  filtrosCicloSchema,
  finalizarCicloSchema,
  liberarCicloSchema,
} from '../esquemas';
import { requiereSesion, type Entorno } from '../middleware';
import { leerJson, leerQuery } from '../validacion';

export const rutasCiclos = new Hono<Entorno>();

/** Traduce los errores de negocio y los abortos de trigger a HTTP. */
function responder(c: Context<Entorno>, error: unknown): Response {
  if (error instanceof ErrorCiclo) {
    const estado = error.codigo === 'ciclo_inexistente' ? 404 : 422;
    return c.json({ error: error.codigo, mensaje: error.message, detalle: error.detalle }, estado);
  }
  const interpretado = interpretarErrorD1(error);
  if (interpretado) {
    return c.json(
      { error: interpretado.codigo, mensaje: interpretado.mensaje },
      interpretado.estadoHttp,
    );
  }
  throw error;
}

rutasCiclos.get('/equipos', async (c) => {
  const db = crearDb(c.env.DB);
  return c.json(
    await db
      .select()
      .from(schema.equipoEsterilizador)
      .where(eq(schema.equipoEsterilizador.activo, 1))
      .orderBy(asc(schema.equipoEsterilizador.nombre)),
  );
});

rutasCiclos.get('/', async (c) => {
  const filtros = leerQuery(c, filtrosCicloSchema);
  if (!filtros.ok) return filtros.respuesta;
  return c.json(await listarCiclos(crearDb(c.env.DB), filtros.datos));
});

rutasCiclos.post('/', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, crearCicloSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    const ciclo = await crearCiclo(crearDb(c.env.DB), c.get('sesion').usuarioId, cuerpo.datos);
    return c.json(ciclo, 201);
  } catch (error) {
    return responder(c, error);
  }
});

rutasCiclos.get('/:ref', async (c) => {
  const db = crearDb(c.env.DB);
  const ciclo = await obtenerCiclo(db, c.req.param('ref'));
  if (!ciclo) return c.json({ error: 'ciclo_inexistente' }, 404);

  return c.json({ ...ciclo, cajas: await cajasDelCiclo(db, ciclo.id) });
});

rutasCiclos.post('/:ref/finalizar', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, finalizarCicloSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return c.json(
      await finalizarCiclo(
        crearDb(c.env.DB),
        c.get('sesion').usuarioId,
        c.req.param('ref'),
        cuerpo.datos,
      ),
    );
  } catch (error) {
    return responder(c, error);
  }
});

/**
 * Carga de controles.
 *
 * Si el biologico sale no conforme, la respuesta trae el recall ya ejecutado:
 * las cajas retiradas y la lista completa de cirugias afectadas. Eso es lo que
 * tiene que estar en pantalla en segundos, no a los diez minutos de buscar.
 */
rutasCiclos.post('/:ref/controles', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, controlesSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    const resultado = await cargarControles(
      crearDb(c.env.DB),
      c.get('sesion').usuarioId,
      c.req.param('ref'),
      { ...cuerpo.datos, ocurridoEn: cuerpo.datos.ocurridoEn ?? new Date().toISOString() },
    );
    return c.json(resultado);
  } catch (error) {
    return responder(c, error);
  }
});

rutasCiclos.post('/:ref/liberar', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, liberarCicloSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const sesion = c.get('sesion');
  if (sesion.rol !== 'supervisor' && sesion.rol !== 'admin') {
    return c.json(
      {
        error: 'rol_insuficiente',
        mensaje: 'La liberacion de un lote la firma un supervisor',
      },
      403,
    );
  }

  try {
    return c.json(
      await liberarCiclo(crearDb(c.env.DB), sesion.usuarioId, c.req.param('ref'), {
        liberadoEn: cuerpo.datos.liberadoEn ?? new Date().toISOString(),
        ...(cuerpo.datos.diasVigencia !== undefined
          ? { diasVigencia: cuerpo.datos.diasVigencia }
          : {}),
      }),
    );
  } catch (error) {
    return responder(c, error);
  }
});

/** Que pasaria (o que paso) con este lote. No escribe nada. */
rutasCiclos.get('/:ref/impacto', async (c) => {
  try {
    return c.json(await impactoDeCiclo(crearDb(c.env.DB), c.req.param('ref')));
  } catch (error) {
    return responder(c, error);
  }
});
