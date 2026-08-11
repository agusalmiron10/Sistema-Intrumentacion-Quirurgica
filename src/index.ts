import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

import { crearDb, schema } from './db';
import { rutasCajas } from './api/rutas/cajas';
import { rutasEtiquetas } from './api/rutas/etiquetas';
import { resolverCaja } from './servicios/cajas';

const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.get('/api/salud', async (c) => {
  const db = crearDb(c.env.DB);
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.transicionValida);
  return c.json({ ok: true, transicionesCargadas: fila?.total ?? 0 });
});

app.route('/api/cajas', rutasCajas);
app.route('/api/etiquetas', rutasEtiquetas);

function escapar(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Destino del QR impreso. Esta URL es permanente: cambiarla obligaria a
 * reimprimir todas las etiquetas.
 *
 * Por ahora muestra una ficha minima. En la fase 3 pasa a ser la entrada a la
 * PWA de escaneo, sin que cambie la URL ni haya que tocar una sola etiqueta.
 */
app.get('/c/:id', async (c) => {
  const caja = await resolverCaja(crearDb(c.env.DB), c.req.param('id'));

  if (!caja) {
    return c.html(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <title>Caja no encontrada</title>
       <body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">
       <h1>Caja no encontrada</h1>
       <p>El codigo escaneado no corresponde a ninguna caja registrada.</p>`,
      404,
    );
  }

  const filas: [string, string][] = [
    ['Estado', caja.estado.replace(/_/g, ' ')],
    ['Servicio', caja.servicio ?? '-'],
    ['Ubicacion', caja.ubicacion ?? '-'],
    ['Vence', caja.venceEl ?? 'sin vencimiento'],
    ['Ciclos', String(caja.ciclosTotales)],
  ];

  return c.html(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${escapar(caja.codigo)}</title>
     <body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">
     <h1 style="margin:0;font-size:2.5rem">${escapar(caja.codigo)}</h1>
     <p style="margin:.25rem 0 1.5rem;color:#555">${escapar(caja.nombre)}</p>
     <table style="border-collapse:collapse;width:100%">
     ${filas
       .map(
         ([clave, valor]) =>
           `<tr><td style="padding:.5rem 0;color:#666">${escapar(clave)}</td>` +
           `<td style="padding:.5rem 0;text-align:right"><strong>${escapar(valor)}</strong></td></tr>`,
       )
       .join('')}
     </table>`,
  );
});

export default app;
