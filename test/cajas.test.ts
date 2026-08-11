import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { ID_CAJA_REGEX } from '../src/dominio/identificadores';
import { sembrarBase } from './ayudas';

const BASE = 'https://test.local';

async function api(ruta: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${BASE}${ruta}`, init);
}

async function postJson(ruta: string, cuerpo: unknown): Promise<Response> {
  return api(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

async function enviarJson(ruta: string, metodo: string, cuerpo: unknown): Promise<Response> {
  return api(ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

beforeAll(async () => {
  await sembrarBase();
  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into instrumento_tipo (id, nombre, codigo) values ('it-1', 'Pinza Kelly', 'KEL')`,
    ),
    env.DB.prepare(
      `insert or ignore into instrumento_tipo (id, nombre, codigo) values ('it-2', 'Tijera Metzenbaum', 'MTZ')`,
    ),
  ]);
});

describe('alta de cajas', () => {
  it('crea una caja con id corto y devuelve la URL del QR', async () => {
    const res = await postJson('/api/cajas', {
      codigo: 'ALT-01',
      nombre: 'Caja de alta',
      servicio: 'Cirugia general',
    });
    expect(res.status).toBe(201);

    const caja = await res.json<{ id: string; codigo: string; estado: string; url: string }>();
    expect(caja.codigo).toBe('ALT-01');
    // Nace en el deposito esteril; a partir de ahi solo se mueve por movimientos.
    expect(caja.estado).toBe('esteril_deposito');
    expect(caja.id).toMatch(ID_CAJA_REGEX);
    expect(caja.url).toBe(`${BASE}/c/${caja.id}`);
  });

  it('normaliza el codigo tipeado a mano', async () => {
    const res = await postJson('/api/cajas', { codigo: '  alt 02 ', nombre: 'Caja normalizada' });
    expect(res.status).toBe(201);
    expect((await res.json<{ codigo: string }>()).codigo).toBe('ALT-02');
  });

  it('rechaza un codigo repetido con 409', async () => {
    await postJson('/api/cajas', { codigo: 'DUP-01', nombre: 'Primera' });
    const res = await postJson('/api/cajas', { codigo: 'DUP-01', nombre: 'Segunda' });

    expect(res.status).toBe(409);
    expect((await res.json<{ codigo: string }>()).codigo).toBe('duplicado');
  });

  it('rechaza el alta invalida con el detalle del campo', async () => {
    const res = await postJson('/api/cajas', { codigo: 'X', nombre: '' });
    expect(res.status).toBe(400);

    const cuerpo = await res.json<{ error: string; detalles: { campo: string }[] }>();
    expect(cuerpo.error).toBe('validacion');
    expect(cuerpo.detalles.map((d) => d.campo).sort()).toEqual(['codigo', 'nombre']);
  });

  it('crea la caja con su contenido esperado en una sola operacion', async () => {
    const res = await postJson('/api/cajas', {
      codigo: 'ALT-03',
      nombre: 'Caja con contenido',
      contenido: [
        { instrumentoTipoId: 'it-1', cantidad: 6 },
        { instrumentoTipoId: 'it-2', cantidad: 2 },
      ],
    });
    expect(res.status).toBe(201);

    const detalle = await (await api('/api/cajas/ALT-03')).json<{
      contenido: { codigo: string; cantidad: number }[];
    }>();
    expect(detalle.contenido).toHaveLength(2);
    expect(detalle.contenido.find((l) => l.codigo === 'KEL')?.cantidad).toBe(6);
  });

  it('no deja una caja a medio crear si el contenido es invalido', async () => {
    const res = await postJson('/api/cajas', {
      codigo: 'ALT-04',
      nombre: 'Caja rota',
      contenido: [{ instrumentoTipoId: 'no-existe', cantidad: 1 }],
    });
    expect(res.status).toBe(422);
    expect((await res.json<{ codigo: string }>()).codigo).toBe('referencia_inexistente');

    // El batch de D1 es transaccional: la caja no tiene que haber quedado.
    expect((await api('/api/cajas/ALT-04')).status).toBe(404);
  });
});

describe('resolucion por id o por codigo', () => {
  it('encuentra la caja por su codigo legible en minusculas', async () => {
    await postJson('/api/cajas', { codigo: 'RES-01', nombre: 'Caja resoluble' });

    const res = await api('/api/cajas/res-01');
    expect(res.status).toBe(200);
    expect((await res.json<{ codigo: string }>()).codigo).toBe('RES-01');
  });

  it('encuentra la misma caja por su id', async () => {
    const creada = await (
      await postJson('/api/cajas', { codigo: 'RES-02', nombre: 'Caja por id' })
    ).json<{ id: string }>();

    const res = await api(`/api/cajas/${creada.id}`);
    expect(res.status).toBe(200);
    expect((await res.json<{ codigo: string }>()).codigo).toBe('RES-02');
  });

  it('devuelve 404 con el ref que se pidio', async () => {
    const res = await api('/api/cajas/NO-EXISTE');
    expect(res.status).toBe(404);
    expect((await res.json<{ error: string }>()).error).toBe('caja_inexistente');
  });
});

describe('edicion de cajas', () => {
  it('actualiza los datos administrativos', async () => {
    await postJson('/api/cajas', { codigo: 'EDI-01', nombre: 'Nombre viejo' });

    const res = await enviarJson('/api/cajas/EDI-01', 'PATCH', {
      nombre: 'Nombre nuevo',
      ubicacion: 'Estante D4',
    });
    expect(res.status).toBe(200);

    const caja = await res.json<{ nombre: string; ubicacion: string }>();
    expect(caja.nombre).toBe('Nombre nuevo');
    expect(caja.ubicacion).toBe('Estante D4');
  });

  it('rechaza cualquier intento de cambiar el estado por esta via', async () => {
    // El estado solo cambia por INSERT en movimiento_caja. Se rechaza explicito
    // en vez de ignorarlo en silencio, para que quede claro que no es el camino.
    await postJson('/api/cajas', { codigo: 'EDI-02', nombre: 'Caja intocable' });

    const res = await enviarJson('/api/cajas/EDI-02', 'PATCH', { estado: 'asignada' });
    expect(res.status).toBe(400);

    const detalle = await api('/api/cajas/EDI-02');
    expect((await detalle.json<{ estado: string }>()).estado).toBe('esteril_deposito');
  });

  it('permite dar de baja administrativamente una caja', async () => {
    await postJson('/api/cajas', { codigo: 'EDI-03', nombre: 'Caja a desactivar' });

    const res = await enviarJson('/api/cajas/EDI-03', 'PATCH', { activa: false });
    expect(res.status).toBe(200);
    expect((await res.json<{ activa: number }>()).activa).toBe(0);
  });
});

describe('contenido esperado', () => {
  it('reemplaza el contenido completo', async () => {
    await postJson('/api/cajas', {
      codigo: 'CON-01',
      nombre: 'Caja de contenido',
      contenido: [{ instrumentoTipoId: 'it-1', cantidad: 3 }],
    });

    const res = await enviarJson('/api/cajas/CON-01/contenido', 'PUT', {
      contenido: [{ instrumentoTipoId: 'it-2', cantidad: 5 }],
    });
    expect(res.status).toBe(200);

    const contenido = await res.json<{ codigo: string; cantidad: number }[]>();
    expect(contenido).toHaveLength(1);
    expect(contenido[0]?.codigo).toBe('MTZ');
    expect(contenido[0]?.cantidad).toBe(5);
  });

  it('rechaza tipos de instrumento repetidos', async () => {
    await postJson('/api/cajas', { codigo: 'CON-02', nombre: 'Caja repetida' });

    const res = await enviarJson('/api/cajas/CON-02/contenido', 'PUT', {
      contenido: [
        { instrumentoTipoId: 'it-1', cantidad: 1 },
        { instrumentoTipoId: 'it-1', cantidad: 2 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rechaza cantidades que no sean enteros positivos', async () => {
    await postJson('/api/cajas', { codigo: 'CON-03', nombre: 'Caja cantidad' });

    const res = await enviarJson('/api/cajas/CON-03/contenido', 'PUT', {
      contenido: [{ instrumentoTipoId: 'it-1', cantidad: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it('marca los instrumentos termosensibles', async () => {
    await env.DB.prepare(
      `insert or ignore into instrumento_tipo (id, nombre, codigo, termosensible)
       values ('it-3', 'Optica 30 grados', 'OPT', 1)`,
    ).run();
    await postJson('/api/cajas', {
      codigo: 'CON-04',
      nombre: 'Caja con optica',
      contenido: [{ instrumentoTipoId: 'it-3', cantidad: 1 }],
    });

    const contenido = await (await api('/api/cajas/CON-04/contenido')).json<
      { termosensible: boolean }[]
    >();
    expect(contenido[0]?.termosensible).toBe(true);
  });
});

describe('listado y filtros', () => {
  it('filtra por estado', async () => {
    const res = await api('/api/cajas?estado=esteril_deposito&limite=500');
    expect(res.status).toBe(200);

    const cajas = await res.json<{ estado: string }[]>();
    expect(cajas.length).toBeGreaterThan(0);
    expect(cajas.every((c) => c.estado === 'esteril_deposito')).toBe(true);
  });

  it('busca por codigo o nombre sin importar mayusculas', async () => {
    await postJson('/api/cajas', { codigo: 'BUS-01', nombre: 'Caja Buscable Unica' });

    const porCodigo = await (await api('/api/cajas?q=bus-01')).json<{ codigo: string }[]>();
    expect(porCodigo.map((c) => c.codigo)).toContain('BUS-01');

    const porNombre = await (await api('/api/cajas?q=buscable')).json<{ codigo: string }[]>();
    expect(porNombre.map((c) => c.codigo)).toContain('BUS-01');
  });

  it('rechaza un estado que no existe', async () => {
    const res = await api('/api/cajas?estado=inventado');
    expect(res.status).toBe(400);
  });
});

describe('destino del QR', () => {
  it('/c/:id muestra la ficha de la caja', async () => {
    const creada = await (
      await postJson('/api/cajas', { codigo: 'QR-01', nombre: 'Caja escaneada', servicio: 'Trauma' })
    ).json<{ id: string }>();

    const res = await api(`/c/${creada.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('QR-01');
    expect(html).toContain('esteril deposito');
  });

  it('/c/:id responde 404 legible si el codigo no corresponde a nada', async () => {
    const res = await api('/c/ZZZZZZZZZZ');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no encontrada');
  });
});
