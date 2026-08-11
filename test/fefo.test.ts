import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api, crearUsuario, ingresar } from './ayudas-api';

let token = '';
const USUARIO = 'st-farmacia';

const enDias = (dias: number): string =>
  new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();

interface Asignacion {
  numeroLote: string;
  cantidad: number;
}

async function crearDescartable(codigo: string, puntoReposicion = 0): Promise<string> {
  const res = await api<{ id: string }>('/api/stock/descartables', {
    metodo: 'POST',
    token,
    cuerpo: { nombre: `Descartable ${codigo}`, codigo, unidad: 'unidad', puntoReposicion },
  });
  return res.cuerpo.id;
}

async function recibir(
  descartableRef: string,
  numeroLote: string,
  cantidad: number,
  venceEnDias: number | null,
): Promise<string> {
  const res = await api<{ id: string }>('/api/stock/lotes', {
    metodo: 'POST',
    token,
    cuerpo: {
      descartableRef,
      numeroLote,
      cantidad,
      venceEl: venceEnDias === null ? null : enDias(venceEnDias),
    },
  });
  return res.cuerpo.id;
}

async function consumir(descartableRef: string, cantidad: number, cirugiaId?: string) {
  return api<{ asignaciones: Asignacion[]; error?: string; detalle?: unknown }>(
    '/api/stock/consumo',
    {
      metodo: 'POST',
      token,
      cuerpo: { descartableRef, cantidad, ...(cirugiaId ? { cirugiaId } : {}) },
    },
  );
}

async function saldo(loteId: string): Promise<number> {
  const fila = await env.DB.prepare('select cantidad_actual as n from lote_descartable where id = ?')
    .bind(loteId)
    .first<{ n: number }>();
  return fila?.n ?? -1;
}

beforeAll(async () => {
  await crearUsuario(USUARIO, 'admin');
  token = await ingresar(USUARIO);
});

describe('consumo FEFO', () => {
  it('toma primero el lote que vence antes', async () => {
    await crearDescartable('ST-01');
    await recibir('ST-01', 'L-LEJANO', 100, 365);
    await recibir('ST-01', 'L-PROXIMO', 100, 30);
    await recibir('ST-01', 'L-MEDIO', 100, 120);

    const res = await consumir('ST-01', 40);
    expect(res.estado).toBe(200);
    expect(res.cuerpo.asignaciones).toHaveLength(1);
    expect(res.cuerpo.asignaciones[0]?.numeroLote).toBe('L-PROXIMO');
    expect(res.cuerpo.asignaciones[0]?.cantidad).toBe(40);
  });

  it('reparte entre lotes cuando uno solo no alcanza', async () => {
    await crearDescartable('ST-02');
    const primero = await recibir('ST-02', 'L-A', 30, 10);
    const segundo = await recibir('ST-02', 'L-B', 50, 60);

    const res = await consumir('ST-02', 45);
    expect(res.cuerpo.asignaciones).toEqual([
      expect.objectContaining({ numeroLote: 'L-A', cantidad: 30 }),
      expect.objectContaining({ numeroLote: 'L-B', cantidad: 15 }),
    ]);

    expect(await saldo(primero)).toBe(0);
    expect(await saldo(segundo)).toBe(35);
  });

  it('los lotes sin vencimiento van al final', async () => {
    // En SQLite los NULL ordenan primero: sin cuidarlo, lo que no vence se
    // consumiria antes que lo que vence la semana que viene.
    await crearDescartable('ST-03');
    await recibir('ST-03', 'L-SIN-FECHA', 100, null);
    await recibir('ST-03', 'L-CON-FECHA', 100, 15);

    const res = await consumir('ST-03', 10);
    expect(res.cuerpo.asignaciones[0]?.numeroLote).toBe('L-CON-FECHA');
  });

  it('a igual vencimiento sale primero el que se recibio antes', async () => {
    await crearDescartable('ST-04');
    await recibir('ST-04', 'L-VIEJO', 20, 45);
    await new Promise((r) => setTimeout(r, 5));
    await recibir('ST-04', 'L-NUEVO', 20, 45);

    const res = await consumir('ST-04', 25);
    expect(res.cuerpo.asignaciones[0]?.numeroLote).toBe('L-VIEJO');
    expect(res.cuerpo.asignaciones[1]?.numeroLote).toBe('L-NUEVO');
  });

  it('NUNCA consume un lote vencido', async () => {
    // FEFO es consumir primero lo que vence antes, no consumir lo vencido.
    // Un descartable vencido no se usa en un paciente.
    await crearDescartable('ST-05');
    const vencido = await recibir('ST-05', 'L-VENCIDO', 100, -5);
    await recibir('ST-05', 'L-VIGENTE', 100, 90);

    const res = await consumir('ST-05', 10);
    expect(res.cuerpo.asignaciones[0]?.numeroLote).toBe('L-VIGENTE');
    expect(await saldo(vencido)).toBe(100);
  });

  it('si no alcanza no consume nada', async () => {
    // Descontar a medias deja el stock movido y la cirugia igual de
    // incompleta, y despues nadie sabe que falto.
    await crearDescartable('ST-06');
    const lote = await recibir('ST-06', 'L-POCO', 10, 90);

    const res = await consumir('ST-06', 25);
    expect(res.estado).toBe(422);
    expect(res.cuerpo.error).toBe('stock_insuficiente');
    expect(await saldo(lote)).toBe(10);
  });

  it('al faltar stock informa cuanto hay vencido sin descartar', async () => {
    // Explica por que el numero del sistema no cierra con lo que se ve en el
    // estante.
    await crearDescartable('ST-07');
    await recibir('ST-07', 'L-V1', 80, -2);
    await recibir('ST-07', 'L-OK', 5, 90);

    const res = await consumir('ST-07', 20);
    expect(res.estado).toBe(422);
    expect(res.cuerpo.detalle).toMatchObject({
      pedido: 20,
      disponible: 5,
      vencidoSinDescartar: 80,
    });
  });

  it('avisa si el descartable no existe', async () => {
    const res = await consumir('NO-EXISTE', 1);
    expect(res.estado).toBe(404);
  });

  it('el orden de consumo se puede consultar antes de consumir', async () => {
    await crearDescartable('ST-08');
    await recibir('ST-08', 'L-2', 10, 200);
    await recibir('ST-08', 'L-1', 10, 20);

    const res = await api<{ ordenDeConsumo: { numeroLote: string }[] }>(
      '/api/stock/descartables/ST-08/lotes',
    );
    expect(res.cuerpo.ordenDeConsumo.map((l) => l.numeroLote)).toEqual(['L-1', 'L-2']);
  });
});

describe('el saldo siempre sale del log', () => {
  it('la recepcion crea el lote en cero y lo carga con un movimiento', async () => {
    await crearDescartable('ST-10');
    const lote = await recibir('ST-10', 'L-ING', 75, 120);

    const fila = await env.DB.prepare(
      `select count(*) as n from movimiento_stock where lote_id = ? and tipo = 'ingreso'`,
    )
      .bind(lote)
      .first<{ n: number }>();

    expect(fila?.n).toBe(1);
    expect(await saldo(lote)).toBe(75);
  });

  it('la devolucion suma y el ajuste negativo resta', async () => {
    await crearDescartable('ST-11');
    const lote = await recibir('ST-11', 'L-DEV', 50, 120);
    await consumir('ST-11', 20);

    await api('/api/stock/movimientos', {
      metodo: 'POST',
      token,
      cuerpo: { loteId: lote, tipo: 'devolucion', cantidad: 5, motivo: 'No se abrio' },
    });
    expect(await saldo(lote)).toBe(35);

    await api('/api/stock/movimientos', {
      metodo: 'POST',
      token,
      cuerpo: { loteId: lote, tipo: 'ajuste', cantidad: -5, motivo: 'Recuento fisico' },
    });
    expect(await saldo(lote)).toBe(30);
  });

  it('rechaza una cantidad negativa que no sea ajuste', async () => {
    await crearDescartable('ST-12');
    const lote = await recibir('ST-12', 'L-NEG', 10, 120);

    const res = await api('/api/stock/movimientos', {
      metodo: 'POST',
      token,
      cuerpo: { loteId: lote, tipo: 'devolucion', cantidad: -5 },
    });
    expect(res.estado).toBe(400);
  });

  it('no deja un lote en rojo', async () => {
    await crearDescartable('ST-13');
    const lote = await recibir('ST-13', 'L-ROJO', 10, 120);

    const res = await api<{ error: string }>('/api/stock/movimientos', {
      metodo: 'POST',
      token,
      cuerpo: { loteId: lote, tipo: 'ajuste', cantidad: -50 },
    });
    expect(res.estado).toBe(422);
    expect(res.cuerpo.error).toBe('stock_insuficiente');
    expect(await saldo(lote)).toBe(10);
  });
});

describe('alertas', () => {
  it('marca lo que esta por debajo del punto de reposicion', async () => {
    await crearDescartable('ST-20', 40);
    await recibir('ST-20', 'L-POCO', 15, 200);

    const res = await api<{ reposicion: { codigo: string; disponible: number }[] }>(
      '/api/stock/alertas',
    );
    const alerta = res.cuerpo.reposicion.find((d) => d.codigo === 'ST-20');
    expect(alerta?.disponible).toBe(15);
  });

  it('lo vencido no cuenta como disponible', async () => {
    // Si se sumara, el sistema diria que hay stock de algo que no se puede
    // usar en un paciente.
    await crearDescartable('ST-21', 50);
    await recibir('ST-21', 'L-VENC', 100, -1);

    const res = await api<{ reposicion: { codigo: string; disponible: number; vencidoSinDescartar: number }[] }>(
      '/api/stock/alertas',
    );
    const alerta = res.cuerpo.reposicion.find((d) => d.codigo === 'ST-21');
    expect(alerta?.disponible).toBe(0);
    expect(alerta?.vencidoSinDescartar).toBe(100);
  });

  it('avisa de los lotes por vencer dentro de la ventana', async () => {
    await crearDescartable('ST-22');
    await recibir('ST-22', 'L-PRONTO', 30, 20);
    await recibir('ST-22', 'L-LEJOS', 30, 300);

    const res = await api<{ porVencer: { numeroLote: string; diasRestantes: number }[] }>(
      '/api/stock/alertas?diasAviso=60',
    );
    const codigos = res.cuerpo.porVencer.map((l) => l.numeroLote);
    expect(codigos).toContain('L-PRONTO');
    expect(codigos).not.toContain('L-LEJOS');

    const pronto = res.cuerpo.porVencer.find((l) => l.numeroLote === 'L-PRONTO');
    expect(pronto?.diasRestantes).toBeGreaterThanOrEqual(19);
    expect(pronto?.diasRestantes).toBeLessThanOrEqual(20);
  });

  it('lista lo vencido que todavia tiene saldo', async () => {
    await crearDescartable('ST-23');
    await recibir('ST-23', 'L-YA-VENCIO', 12, -10);

    const res = await api<{ vencidos: { numeroLote: string; cantidad: number }[] }>(
      '/api/stock/alertas',
    );
    expect(res.cuerpo.vencidos.find((l) => l.numeroLote === 'L-YA-VENCIO')?.cantidad).toBe(12);
  });

  it('descartar vencidos deja los lotes en cero', async () => {
    await crearDescartable('ST-24');
    const lote = await recibir('ST-24', 'L-A-DESCARTAR', 40, -3);

    const res = await api<{ dados: { numeroLote: string }[] }>('/api/stock/descartar-vencidos', {
      metodo: 'POST',
      token,
    });
    expect(res.cuerpo.dados.map((d) => d.numeroLote)).toContain('L-A-DESCARTAR');
    expect(await saldo(lote)).toBe(0);
  });
});

describe('consumo desde una cirugia', () => {
  it('descuenta lo planificado y queda trazable hasta el lote', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `insert or ignore into procedimiento (id, nombre, codigo) values ('st-proc', 'Procedimiento stock', 'ST-PROC')`,
      ),
      env.DB.prepare(
        `insert or ignore into cirujano (id, nombre, matricula) values ('st-ciru', 'Dr. Stock', 'MN 20001')`,
      ),
    ]);

    const sutura = await crearDescartable('ST-30');
    await recibir('ST-30', 'L-SUT-VIEJO', 3, 15);
    await recibir('ST-30', 'L-SUT-NUEVO', 50, 300);

    await api('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'st-proc',
        cirujanoId: null,
        cajas: [],
        descartables: [{ descartableId: sutura, cantidad: 5 }],
      },
    });

    const cirugia = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-ST-01',
        procedimientoId: 'st-proc',
        cirujanoId: 'st-ciru',
        programadaPara: new Date().toISOString(),
      },
    });
    const cirugiaId = cirugia.cuerpo.cirugia.id;

    const res = await api<{
      consumidos: { asignaciones: Asignacion[] }[];
      faltantes: unknown[];
    }>(`/api/cirugias/${cirugiaId}/consumir`, { metodo: 'POST', token });

    expect(res.estado).toBe(200);
    expect(res.cuerpo.faltantes).toHaveLength(0);
    // Agarra los 3 del lote que vence antes y completa con el otro.
    expect(res.cuerpo.consumidos[0]?.asignaciones).toEqual([
      expect.objectContaining({ numeroLote: 'L-SUT-VIEJO', cantidad: 3 }),
      expect.objectContaining({ numeroLote: 'L-SUT-NUEVO', cantidad: 2 }),
    ]);

    const traza = await api<{ consumos: { numeroLote: string; cantidad: number }[] }>(
      `/api/cirugias/${cirugiaId}/trazabilidad`,
    );
    expect(traza.cuerpo.consumos.map((c) => c.numeroLote).sort()).toEqual([
      'L-SUT-NUEVO',
      'L-SUT-VIEJO',
    ]);
  });

  it('lo que falta no impide descontar el resto', async () => {
    const hay = await crearDescartable('ST-40');
    const noHay = await crearDescartable('ST-41');
    await recibir('ST-40', 'L-HAY', 20, 200);

    await api('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'st-proc',
        cirujanoId: 'st-ciru',
        cajas: [],
        descartables: [
          { descartableId: hay, cantidad: 2 },
          { descartableId: noHay, cantidad: 4 },
        ],
      },
    });

    const cirugia = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-ST-02',
        procedimientoId: 'st-proc',
        cirujanoId: 'st-ciru',
        programadaPara: new Date().toISOString(),
      },
    });

    const res = await api<{
      consumidos: unknown[];
      faltantes: { descartable: string }[];
    }>(`/api/cirugias/${cirugia.cuerpo.cirugia.id}/consumir`, { metodo: 'POST', token });

    expect(res.cuerpo.consumidos).toHaveLength(1);
    expect(res.cuerpo.faltantes).toHaveLength(1);
    expect(res.cuerpo.faltantes[0]?.descartable).toContain('ST-41');
  });
});
