import { Hono } from 'hono';

import { crearDb } from '../../db';
import { sincronizarEventos } from '../../servicios/eventos';
import { sincronizarSchema } from '../esquemas';
import { requiereSesion, type Entorno } from '../middleware';
import { leerJson } from '../validacion';

export const rutasEventos = new Hono<Entorno>();

/**
 * Sincroniza un lote de escaneos.
 *
 * Devuelve SIEMPRE 200 con el detalle por evento, incluso si algunos fueron
 * rechazados. Un 4xx global obligaria al cliente a adivinar cuales quedaron
 * aplicados y cuales no, y la cola offline no puede darse ese lujo: necesita
 * saber, evento por evento, cual borrar y cual mostrar como conflicto.
 */
rutasEventos.post('/', requiereSesion, async (c) => {
  const cuerpo = await leerJson(c, sincronizarSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const resultados = await sincronizarEventos(
    crearDb(c.env.DB),
    c.get('sesion').usuarioId,
    cuerpo.datos.eventos,
  );

  return c.json({
    resultados,
    resumen: {
      aplicados: resultados.filter((r) => r.estado === 'aplicado').length,
      duplicados: resultados.filter((r) => r.estado === 'duplicado').length,
      conflictos: resultados.filter((r) => r.estado === 'conflicto').length,
    },
  });
});
