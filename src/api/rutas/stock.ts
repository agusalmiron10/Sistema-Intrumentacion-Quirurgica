import { Hono } from 'hono';

import { crearDb, schema } from '../../db';
import {
  alertas,
  consumirFefo,
  descartarVencidos,
  existencias,
  lotesDe,
  lotesDisponibles,
  movimientoDirecto,
  movimientosDe,
  recibirLote,
  resolverDescartable,
} from '../../servicios/stock';
import {
  alertasSchema,
  consumoSchema,
  crearDescartableSchema,
  filtrosStockSchema,
  movimientoStockSchema,
  recibirLoteSchema,
} from '../esquemas';
import { requiereSesion, type Entorno } from '../middleware';
import { responderError } from '../respuestas';
import { leerJson, leerQuery } from '../validacion';

export const rutasStock = new Hono<Entorno>();

const ahora = (): string => new Date().toISOString();

rutasStock.get('/', async (c) => {
  return c.json(await existencias(crearDb(c.env.DB), ahora()));
});

/**
 * Alertas de reposicion y de vencimiento.
 *
 * Lo vencido se cuenta aparte del disponible, no dentro: si se sumara, el
 * sistema diria que hay stock de algo que no se puede usar en un paciente.
 */
rutasStock.get('/alertas', async (c) => {
  const filtros = leerQuery(c, alertasSchema);
  if (!filtros.ok) return filtros.respuesta;
  return c.json(await alertas(crearDb(c.env.DB), ahora(), filtros.datos.diasAviso));
});

rutasStock.get('/movimientos', async (c) => {
  const filtros = leerQuery(c, filtrosStockSchema);
  if (!filtros.ok) return filtros.respuesta;
  return c.json(await movimientosDe(crearDb(c.env.DB), filtros.datos));
});

rutasStock.post('/descartables', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, crearDescartableSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  try {
    const id = crypto.randomUUID();
    await db.insert(schema.descartable).values({ id, ...cuerpo.datos });
    return c.json({ id, ...cuerpo.datos }, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasStock.get('/descartables/:ref/lotes', async (c) => {
  const db = crearDb(c.env.DB);
  const descartable = await resolverDescartable(db, c.req.param('ref'));
  if (!descartable) return c.json({ error: 'descartable_inexistente' }, 404);

  return c.json({
    descartable,
    lotes: await lotesDe(db, descartable.id),
    /** En el orden exacto en que el consumo FEFO los va a ir tomando. */
    ordenDeConsumo: (await lotesDisponibles(db, descartable.id, ahora())).map((l) => ({
      id: l.id,
      numeroLote: l.numeroLote,
      venceEl: l.venceEl,
      cantidadActual: l.cantidadActual,
    })),
  });
});

rutasStock.post('/lotes', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, recibirLoteSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return c.json(
      await recibirLote(crearDb(c.env.DB), c.get('sesion').usuarioId, {
        ...cuerpo.datos,
        recibidoEn: cuerpo.datos.recibidoEn ?? ahora(),
      }),
      201,
    );
  } catch (error) {
    return responderError(c, error);
  }
});

rutasStock.post('/consumo', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, consumoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return c.json(
      await consumirFefo(
        crearDb(c.env.DB),
        c.get('sesion').usuarioId,
        cuerpo.datos.descartableRef,
        cuerpo.datos.cantidad,
        { ...cuerpo.datos, ocurridoEn: cuerpo.datos.ocurridoEn ?? ahora() },
      ),
    );
  } catch (error) {
    return responderError(c, error);
  }
});

rutasStock.post('/movimientos', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, movimientoStockSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  if (cuerpo.datos.tipo !== 'ajuste' && cuerpo.datos.cantidad <= 0) {
    return c.json(
      { error: 'validacion', mensaje: 'Solo el ajuste admite cantidades negativas' },
      400,
    );
  }

  try {
    return c.json(
      await movimientoDirecto(crearDb(c.env.DB), c.get('sesion').usuarioId, {
        ...cuerpo.datos,
        ocurridoEn: cuerpo.datos.ocurridoEn ?? ahora(),
      }),
    );
  } catch (error) {
    return responderError(c, error);
  }
});

/** Da de baja de una lo que ya vencio y sigue con saldo. */
rutasStock.post('/descartar-vencidos', requiereSesion, async (c) => {
  try {
    const momento = ahora();
    return c.json({
      momento,
      dados: await descartarVencidos(crearDb(c.env.DB), c.get('sesion').usuarioId, momento),
    });
  } catch (error) {
    return responderError(c, error);
  }
});
