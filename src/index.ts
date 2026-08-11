import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

import { crearDb, schema } from './db';
import { rutasCajas } from './api/rutas/cajas';
import { rutasEtiquetas } from './api/rutas/etiquetas';
import { rutasCatalogos } from './api/rutas/catalogos';
import { rutasCiclos } from './api/rutas/ciclos';
import { rutasCirugias } from './api/rutas/cirugias';
import { rutasEventos } from './api/rutas/eventos';
import { rutasPlantillas } from './api/rutas/plantillas';
import { rutasReportes } from './api/rutas/reportes';
import { rutasStock } from './api/rutas/stock';
import { rutasSesion } from './api/rutas/sesion';
import type { Entorno } from './api/middleware';
import { resolverCaja } from './servicios/cajas';

const app = new Hono<Entorno>();

app.get('/api/salud', async (c) => {
  const db = crearDb(c.env.DB);
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.transicionValida);
  return c.json({ ok: true, transicionesCargadas: fila?.total ?? 0 });
});

app.route('/api', rutasSesion);
app.route('/api/cajas', rutasCajas);
app.route('/api/etiquetas', rutasEtiquetas);
app.route('/api/eventos', rutasEventos);
app.route('/api/ciclos', rutasCiclos);
app.route('/api/plantillas', rutasPlantillas);
app.route('/api/cirugias', rutasCirugias);
app.route('/api/stock', rutasStock);
app.route('/api/reportes', rutasReportes);
app.route('/api', rutasCatalogos);

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

/**
 * La PWA y la API viven en el mismo origen: los assets estaticos los sirve el
 * mismo Worker. Asi no hay CORS ni cookies cross-site, que es exactamente el
 * tipo de cosa que despues falla en un navegador de hospital con la
 * configuracion restringida.
 *
 * Los archivos que existen los resuelve la capa de assets antes de llegar aca.
 * Lo que cae en este notFound es o una ruta de la API que no existe, o una
 * ruta del router del frontend, que se resuelve devolviendo el index.
 */
app.notFound(async (c) => {
  const ruta = new URL(c.req.url).pathname;

  if (ruta.startsWith('/api/')) {
    return c.json({ error: 'no_encontrado', mensaje: 'Esa ruta de la API no existe' }, 404);
  }

  // Un archivo que no existe tiene que dar 404 de verdad. Devolverle el index
  // a un pedido de /assets/algo.js hace que el navegador reciba HTML donde
  // espera JavaScript, y el error que muestra ("MIME type text/html") no se
  // parece en nada al problema real. Pasa de verdad: al desplegar una version
  // nueva, una pestania abierta sigue pidiendo los chunks viejos.
  const ultimoTramo = ruta.slice(ruta.lastIndexOf('/') + 1);
  if (ultimoTramo.includes('.')) {
    return c.text('No encontrado', 404);
  }

  const index = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
  return new Response(index.body, {
    status: index.status === 200 ? 200 : 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

export default app;
