import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api, BASE, crearUsuario, hace, ingresar } from './ayudas-api';

let token = '';
const USUARIO = 'rp-admin';

/** Un xlsx es un ZIP: la firma PK esta al principio. */
function esXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function descargar(ruta: string): Promise<{ estado: number; bytes: Uint8Array; nombre: string; tipo: string }> {
  const res = await SELF.fetch(`${BASE}${ruta}`);
  if (res.status !== 200) {
    return { estado: res.status, bytes: new Uint8Array(), nombre: '', tipo: '' };
  }
  return {
    estado: res.status,
    bytes: new Uint8Array(await res.arrayBuffer()),
    nombre: res.headers.get('content-disposition') ?? '',
    tipo: res.headers.get('content-type') ?? '',
  };
}

/** Lee los xml del xlsx para poder verificar el contenido, no solo el formato. */
async function textoDelXlsx(bytes: Uint8Array): Promise<string> {
  const ExcelJS = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes as unknown as ArrayBuffer);

  const partes: string[] = [];
  libro.eachSheet((hoja) => {
    partes.push(`[[${hoja.name}]]`);
    hoja.eachRow((fila) => {
      partes.push(
        (fila.values as unknown[])
          .slice(1)
          .map((v) => (v === null || v === undefined ? '' : String(v)))
          .join(' | '),
      );
    });
  });
  return partes.join('\n');
}

beforeAll(async () => {
  await crearUsuario(USUARIO, 'admin');
  token = await ingresar(USUARIO);

  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into equipo_esterilizador (id, nombre, marca) values ('rp-eq', 'Autoclave reportes', 'Getinge')`,
    ),
    env.DB.prepare(
      `insert or ignore into procedimiento (id, nombre, codigo) values ('rp-proc', 'Procedimiento reportes', 'RP-PROC')`,
    ),
    env.DB.prepare(
      `insert or ignore into cirujano (id, nombre, matricula) values ('rp-ciru', 'Dr. Reporte', 'MN 30001')`,
    ),
    env.DB.prepare(
      `insert or ignore into instrumento_tipo (id, nombre, codigo, termosensible) values ('rp-inst', 'Optica 30 grados', 'RP-OPT', 1)`,
    ),
  ]);
});

describe('reporte de stock', () => {
  it('sale un xlsx con existencias, lotes y alertas', async () => {
    await api('/api/stock/descartables', {
      metodo: 'POST',
      token,
      cuerpo: {
        nombre: 'Sutura de reporte',
        codigo: 'RP-SUT',
        unidad: 'unidad',
        puntoReposicion: 100,
      },
    });
    await api('/api/stock/lotes', {
      metodo: 'POST',
      token,
      cuerpo: {
        descartableRef: 'RP-SUT',
        numeroLote: 'RP-L1',
        cantidad: 20,
        venceEl: new Date(Date.now() + 15 * 86400000).toISOString(),
      },
    });

    const res = await descargar('/api/reportes/stock');
    expect(res.estado).toBe(200);
    expect(esXlsx(res.bytes)).toBe(true);
    expect(res.tipo).toContain('spreadsheetml');
    expect(res.nombre).toContain('.xlsx');

    const texto = await textoDelXlsx(res.bytes);
    expect(texto).toContain('[[Existencias]]');
    expect(texto).toContain('[[Lotes]]');
    expect(texto).toContain('[[Alertas]]');
    expect(texto).toContain('RP-SUT');
    expect(texto).toContain('RP-L1');
  });

  it('marca lo que hay que reponer y lo que esta por vencer', async () => {
    const texto = await textoDelXlsx((await descargar('/api/reportes/stock')).bytes);
    // 20 disponibles contra un punto de reposicion de 100.
    expect(texto).toContain('Sutura de reporte');
    expect(texto).toMatch(/Reposicion|Por vencer/);
  });
});

describe('reporte de trazabilidad de una cirugia', () => {
  it('incluye cajas, movimientos, esterilizacion y descartables', async () => {
    const caja = await api<{ id: string }>('/api/cajas', {
      metodo: 'POST',
      token,
      cuerpo: {
        codigo: 'RP-01',
        nombre: 'Caja de reporte',
        servicio: 'Cirugia general',
        contenido: [{ instrumentoTipoId: 'rp-inst', cantidad: 1 }],
      },
    });

    await api('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'rp-proc',
        cirujanoId: null,
        cajas: [{ cajaId: caja.cuerpo.id }],
        descartables: [],
      },
    });

    const cirugia = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-RP-01',
        procedimientoId: 'rp-proc',
        cirujanoId: 'rp-ciru',
        quirofano: 'Q9',
        programadaPara: hace(-120),
      },
    });
    await api(`/api/cirugias/${cirugia.cuerpo.cirugia.id}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'preparada' },
    });

    const res = await descargar(`/api/reportes/cirugias/${cirugia.cuerpo.cirugia.id}`);
    expect(res.estado).toBe(200);
    expect(esXlsx(res.bytes)).toBe(true);
    expect(res.nombre).toContain('PAC-RP-01');

    const texto = await textoDelXlsx(res.bytes);
    expect(texto).toContain('[[Cirugia]]');
    expect(texto).toContain('[[Movimientos]]');
    expect(texto).toContain('[[Esterilizacion]]');
    expect(texto).toContain('[[Descartables]]');
    expect(texto).toContain('PAC-RP-01');
    expect(texto).toContain('RP-01');
    expect(texto).toContain('Q9');
  });

  it('no filtra ningun dato clinico', async () => {
    // El reporte se comparte por mail y se imprime: es el lugar mas facil para
    // que se escape algo que el sistema no deberia tener.
    const cirugias = await api<{ id: string }[]>('/api/cirugias?limite=1');
    const texto = await textoDelXlsx(
      (await descargar(`/api/reportes/cirugias/${cirugias.cuerpo[0]?.id}`)).bytes,
    );

    expect(texto.toLowerCase()).not.toContain('diagnostico');
    expect(texto.toLowerCase()).not.toContain('documento');
    expect(texto).toContain('Referencia de paciente');
  });

  it('404 si la cirugia no existe', async () => {
    expect((await descargar('/api/reportes/cirugias/no-existe')).estado).toBe(404);
  });
});

describe('reporte de historial de una caja', () => {
  it('trae la ficha, el contenido esperado y todos los movimientos', async () => {
    const res = await descargar('/api/reportes/cajas/RP-01');
    expect(res.estado).toBe(200);
    expect(res.nombre).toContain('historial-RP-01.xlsx');

    const texto = await textoDelXlsx(res.bytes);
    expect(texto).toContain('[[Caja]]');
    expect(texto).toContain('[[Contenido esperado]]');
    expect(texto).toContain('[[Historial]]');
    expect(texto).toContain('Optica 30 grados');
    expect(texto).toContain('asignada');
  });

  it('muestra ocurrido y registrado por separado', async () => {
    // La diferencia entre ambos es lo que revela que el escaneo se hizo sin
    // señal y se sincronizo despues.
    const texto = await textoDelXlsx((await descargar('/api/reportes/cajas/RP-01')).bytes);
    expect(texto).toContain('Ocurrido');
    expect(texto).toContain('Registrado');
  });

  it('resuelve la caja por codigo en minusculas', async () => {
    expect((await descargar('/api/reportes/cajas/rp-01')).estado).toBe(200);
  });

  it('404 si la caja no existe', async () => {
    expect((await descargar('/api/reportes/cajas/NO-EXISTE')).estado).toBe(404);
  });
});

describe('reporte de productividad por ciclo', () => {
  it('lista los ciclos y resume por equipo', async () => {
    const caja = await api<{ id: string }>('/api/cajas', {
      metodo: 'POST',
      token,
      cuerpo: { codigo: 'RP-10', nombre: 'Caja de ciclo' },
    });

    await api('/api/eventos', {
      metodo: 'POST',
      token,
      cuerpo: {
        eventos: [
          ['esteril_deposito', 'en_lavado'],
          ['en_lavado', 'en_armado'],
        ].map(([desde, hasta], i) => ({
          id: crypto.randomUUID(),
          cajaRef: caja.cuerpo.id,
          usuarioId: USUARIO,
          estadoDesde: desde,
          estadoHasta: hasta,
          ocurridoEn: hace(300 - i),
        })),
      },
    });

    const ciclo = await api<{ id: string }>('/api/ciclos', {
      metodo: 'POST',
      token,
      cuerpo: {
        numeroLote: 'RP-LOTE-01',
        equipoId: 'rp-eq',
        metodo: 'vapor_134',
        iniciadoEn: hace(240),
        cajaRefs: ['RP-10'],
      },
    });
    await api(`/api/ciclos/${ciclo.cuerpo.id}/finalizar`, {
      metodo: 'POST',
      token,
      cuerpo: { finalizadoEn: hace(180), temperaturaC: 134, tiempoMin: 45 },
    });

    const res = await descargar('/api/reportes/ciclos');
    expect(res.estado).toBe(200);
    expect(esXlsx(res.bytes)).toBe(true);

    const texto = await textoDelXlsx(res.bytes);
    expect(texto).toContain('[[Ciclos]]');
    expect(texto).toContain('[[Por equipo]]');
    expect(texto).toContain('RP-LOTE-01');
    expect(texto).toContain('Autoclave reportes');
    // Duracion calculada entre iniciado y finalizado.
    expect(texto).toContain('60');
  });

  it('filtra por rango de fechas', async () => {
    const vacio = await descargar(
      '/api/reportes/ciclos?desde=2020-01-01T00:00:00.000Z&hasta=2020-12-31T00:00:00.000Z',
    );
    expect(vacio.estado).toBe(200);

    const texto = await textoDelXlsx(vacio.bytes);
    expect(texto).not.toContain('RP-LOTE-01');
  });
});
