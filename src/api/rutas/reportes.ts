import { Hono, type Context } from 'hono';

import { crearDb } from '../../db';
import {
  reporteCaja,
  reporteCiclos,
  reporteCirugia,
  reporteStock,
  type Reporte,
} from '../../servicios/reportes';
import type { Entorno } from '../middleware';
import { responderError } from '../respuestas';

/**
 * Exportaciones a Excel.
 *
 * Las rutas no llevan la extension en el path: el nombre del archivo lo fija
 * Content-Disposition, que es lo que el navegador usa igual. Meter un ".xlsx"
 * en el path solo confundiria al router con el parametro.
 */
export const rutasReportes = new Hono<Entorno>();

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function comoDescarga(c: Context<Entorno>, reporte: Reporte): Response {
  return c.body(reporte.bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': TIPO_XLSX,
    'Content-Disposition': `attachment; filename="${reporte.nombreArchivo}"`,
    // Un reporte es una foto de un momento: cachearlo seria mostrar datos viejos.
    'Cache-Control': 'no-store',
  });
}

rutasReportes.get('/stock', async (c) => {
  const dias = Number.parseInt(c.req.query('diasAviso') ?? '60', 10);
  return comoDescarga(
    c,
    await reporteStock(
      crearDb(c.env.DB),
      new Date().toISOString(),
      Number.isSafeInteger(dias) && dias > 0 ? dias : 60,
    ),
  );
});

rutasReportes.get('/cirugias/:id', async (c) => {
  try {
    return comoDescarga(c, await reporteCirugia(crearDb(c.env.DB), c.req.param('id')));
  } catch (error) {
    return responderError(c, error);
  }
});

rutasReportes.get('/cajas/:ref', async (c) => {
  try {
    return comoDescarga(c, await reporteCaja(crearDb(c.env.DB), c.req.param('ref')));
  } catch (error) {
    return responderError(c, error);
  }
});

rutasReportes.get('/ciclos', async (c) => {
  return comoDescarga(
    c,
    await reporteCiclos(crearDb(c.env.DB), {
      desde: c.req.query('desde'),
      hasta: c.req.query('hasta'),
    }),
  );
});
