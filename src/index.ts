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
import { rutasUsuarios } from './api/rutas/usuarios';
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
app.route('/api', rutasUsuarios);
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
       <style>
         body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #334155; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
         .card { background: #fff; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 24rem; }
         .icon { font-size: 3rem; margin-bottom: 1rem; display: block; }
         h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #0f172a; }
         p { margin: 0; color: #64748b; line-height: 1.5; }
       </style>
       <body>
         <div class="card">
           <span class="icon">🔍</span>
           <h1>Caja no encontrada</h1>
           <p>El código escaneado no corresponde a ninguna caja registrada en el sistema.</p>
         </div>
       </body>`,
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
     <style>
       body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #334155; margin: 0; padding: 1.5rem 1rem; display: flex; justify-content: center; }
       .card { background: #fff; width: 100%; max-width: 26rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); overflow: hidden; }
       .header { background: #0d9488; color: #fff; padding: 1.5rem; text-align: center; }
       .codigo { margin: 0; font-size: 2.5rem; font-weight: 800; letter-spacing: -0.025em; line-height: 1; }
       .nombre { margin: 0.5rem 0 0; font-size: 1.1rem; color: #ccfbf1; font-weight: 500; }
       .content { padding: 1.5rem; }
       .row { display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid #e2e8f0; }
       .row:last-child { border-bottom: none; padding-bottom: 0; }
       .label { color: #64748b; font-size: 0.875rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }
       .value { font-weight: 700; color: #0f172a; text-align: right; }
     </style>
     <body>
       <div class="card">
         <div class="header">
           <h1 class="codigo">${escapar(caja.codigo)}</h1>
           <p class="nombre">${escapar(caja.nombre)}</p>
         </div>
         <div class="content">
           ${filas
             .map(
                ([clave, valor]) =>
                  `<div class="row"><span class="label">${escapar(clave)}</span><span class="value">${escapar(valor)}</span></div>`,
             )
             .join('')}
         </div>
       </div>
     </body>`,
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
