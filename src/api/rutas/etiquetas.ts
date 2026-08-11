import { Hono } from 'hono';

import { crearDb } from '../../db';
import { resolverCaja } from '../../servicios/cajas';
import { calcularGeometria, generarPliego, type CajaEtiqueta } from '../../servicios/etiquetas';
import { dominioPublico } from '../dominio';
import { etiquetasSchema } from '../esquemas';
import { leerJson } from '../validacion';

export const rutasEtiquetas = new Hono<{ Bindings: Cloudflare.Env }>();

/**
 * Pliego de etiquetas en PDF.
 *
 * Acepta ids y codigos legibles mezclados, porque en la practica la lista sale
 * de un inventario en papel. Si alguna referencia no existe, no se imprime un
 * pliego incompleto sin avisar: se devuelve 422 con la lista de las que
 * fallaron. Imprimir 200 etiquetas y descubrir despues que faltan tres es
 * exactamente el error que no queremos.
 */
rutasEtiquetas.post('/', async (c) => {
  const cuerpo = await leerJson(c, etiquetasSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  const encontradas: CajaEtiqueta[] = [];
  const faltantes: string[] = [];

  for (const ref of cuerpo.datos.refs) {
    const caja = await resolverCaja(db, ref);
    if (caja) {
      encontradas.push({
        id: caja.id,
        codigo: caja.codigo,
        nombre: caja.nombre,
        servicio: caja.servicio,
      });
    } else {
      faltantes.push(ref);
    }
  }

  if (faltantes.length > 0) {
    return c.json(
      {
        error: 'refs_inexistentes',
        mensaje: 'No se genero el pliego porque hay referencias que no existen',
        faltantes,
      },
      422,
    );
  }

  const pdf = await generarPliego(encontradas, {
    dominio: dominioPublico(c),
    ladoQrMm: cuerpo.datos.ladoQrMm,
    incluirBorde: cuerpo.datos.incluirBorde,
  });

  const geo = calcularGeometria(cuerpo.datos.ladoQrMm);
  return c.body(pdf as unknown as ArrayBuffer, 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="etiquetas-cajas.pdf"',
    'X-Etiquetas-Total': String(encontradas.length),
    'X-Etiquetas-Por-Pagina': String(geo.porPagina),
  });
});
