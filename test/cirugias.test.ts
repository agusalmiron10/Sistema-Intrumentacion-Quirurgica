import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api, crearUsuario, hace, ingresar, moverCaja } from './ayudas-api';

let token = '';
const USUARIO = 'cx-instr';

interface PlantillaResp {
  id: string;
  version: number;
  vigente: number;
  cajas: { cajaId: string; codigo: string }[];
  descartables: { codigo: string; cantidad: number }[];
}

async function crearCaja(codigo: string): Promise<string> {
  const res = await api<{ id: string }>('/api/cajas', {
    metodo: 'POST',
    cuerpo: { codigo, nombre: `Caja ${codigo}` },
  });
  return res.cuerpo.id;
}

beforeAll(async () => {
  await crearUsuario(USUARIO, 'instrumentadora');
  token = await ingresar(USUARIO);

  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into procedimiento (id, nombre, codigo) values ('cx-proc', 'Colecistectomia laparoscopica', 'CX-COLE')`,
    ),
    env.DB.prepare(
      `insert or ignore into procedimiento (id, nombre, codigo) values ('cx-proc2', 'Hernioplastia', 'CX-HERN')`,
    ),
    env.DB.prepare(
      `insert or ignore into cirujano (id, nombre, matricula) values ('cx-sosa', 'Dr. Sosa', 'MN 10001')`,
    ),
    env.DB.prepare(
      `insert or ignore into cirujano (id, nombre, matricula) values ('cx-bianchi', 'Dra. Bianchi', 'MN 10002')`,
    ),
    env.DB.prepare(
      `insert or ignore into descartable (id, nombre, codigo, unidad) values ('cx-sutura', 'Sutura Vicryl', 'CX-VIC', 'unidad')`,
    ),
    env.DB.prepare(
      `insert or ignore into descartable (id, nombre, codigo, unidad) values ('cx-clips', 'Clips titanio', 'CX-CLI', 'cartucho')`,
    ),
  ]);
});

describe('versionado de plantillas', () => {
  it('crea la primera version como vigente', async () => {
    const cajaId = await crearCaja('CX-01');
    const res = await api<PlantillaResp>('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'cx-proc',
        cirujanoId: null,
        cajas: [{ cajaId }],
        descartables: [{ descartableId: 'cx-sutura', cantidad: 2 }],
      },
    });

    expect(res.estado).toBe(201);
    expect(res.cuerpo.version).toBe(1);
    expect(res.cuerpo.vigente).toBe(1);
    expect(res.cuerpo.cajas).toHaveLength(1);
  });

  it('crear otra version baja la anterior y sube el numero', async () => {
    // Las plantillas no se editan: se versionan. La vieja sigue existiendo
    // porque las cirugias que la usaron la referencian.
    const cajaId = await crearCaja('CX-02');
    const segunda = await api<PlantillaResp>('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'cx-proc',
        cirujanoId: null,
        cajas: [{ cajaId }],
        descartables: [{ descartableId: 'cx-sutura', cantidad: 4 }],
      },
    });

    expect(segunda.cuerpo.version).toBe(2);

    const vigentes = await api<{ id: string }[]>(
      '/api/plantillas?procedimientoId=cx-proc&soloVigentes=1',
    );
    expect(vigentes.cuerpo).toHaveLength(1);
    expect(vigentes.cuerpo[0]?.id).toBe(segunda.cuerpo.id);

    const todas = await api<unknown[]>('/api/plantillas?procedimientoId=cx-proc&soloVigentes=0');
    expect(todas.cuerpo.length).toBeGreaterThanOrEqual(2);
  });

  it('la generica y la del cirujano conviven', async () => {
    const cajaId = await crearCaja('CX-03');
    const res = await api<PlantillaResp>('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'cx-proc',
        cirujanoId: 'cx-sosa',
        cajas: [{ cajaId }],
        descartables: [{ descartableId: 'cx-clips', cantidad: 2 }],
      },
    });
    expect(res.estado).toBe(201);
    expect(res.cuerpo.version).toBe(1);

    const vigentes = await api<unknown[]>(
      '/api/plantillas?procedimientoId=cx-proc&soloVigentes=1',
    );
    expect(vigentes.cuerpo).toHaveLength(2);
  });
});

describe('resolucion de plantilla', () => {
  it('prefiere la del cirujano sobre la generica', async () => {
    const res = await api<{ encontrada: boolean; origen: string }>(
      '/api/plantillas/resolver?procedimientoId=cx-proc&cirujanoId=cx-sosa',
    );
    expect(res.cuerpo.encontrada).toBe(true);
    expect(res.cuerpo.origen).toBe('cirujano');
  });

  it('cae a la generica si el cirujano no tiene la suya', async () => {
    const res = await api<{ encontrada: boolean; origen: string }>(
      '/api/plantillas/resolver?procedimientoId=cx-proc&cirujanoId=cx-bianchi',
    );
    expect(res.cuerpo.encontrada).toBe(true);
    expect(res.cuerpo.origen).toBe('generica');
  });

  it('avisa cuando no hay ninguna', async () => {
    const res = await api<{ encontrada: boolean }>(
      '/api/plantillas/resolver?procedimientoId=cx-proc2&cirujanoId=cx-sosa',
    );
    expect(res.cuerpo.encontrada).toBe(false);
  });
});

describe('creacion de cirugias', () => {
  it('copia la plantilla resuelta en vez de referenciarla', async () => {
    const creada = await api<{ cirugia: { id: string; plantillaId: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-CX-01',
        procedimientoId: 'cx-proc',
        cirujanoId: 'cx-sosa',
        quirofano: 'Q1',
        programadaPara: hace(-60),
      },
    });
    expect(creada.estado).toBe(201);

    const detalle = await api<{
      cajas: { codigo: string }[];
      descartables: { codigo: string; cantidadPlanificada: number }[];
    }>(`/api/cirugias/${creada.cuerpo.cirugia.id}`);

    expect(detalle.cuerpo.cajas.map((c) => c.codigo)).toEqual(['CX-03']);
    expect(detalle.cuerpo.descartables[0]?.codigo).toBe('CX-CLI');
    expect(detalle.cuerpo.descartables[0]?.cantidadPlanificada).toBe(2);
  });

  it('cambiar la plantilla despues no toca las cirugias ya creadas', async () => {
    // El historico tiene que reflejar lo que realmente se preparo para ese
    // paciente, no lo que hoy dice la preference card.
    const creada = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-CX-02',
        procedimientoId: 'cx-proc',
        cirujanoId: 'cx-bianchi',
        programadaPara: hace(-60),
      },
    });

    const antes = await api<{ descartables: { cantidadPlanificada: number }[] }>(
      `/api/cirugias/${creada.cuerpo.cirugia.id}`,
    );
    const cantidadOriginal = antes.cuerpo.descartables[0]?.cantidadPlanificada;

    const cajaId = await crearCaja('CX-04');
    await api('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'cx-proc',
        cirujanoId: null,
        cajas: [{ cajaId }],
        descartables: [{ descartableId: 'cx-sutura', cantidad: 99 }],
      },
    });

    const despues = await api<{
      cajas: { codigo: string }[];
      descartables: { cantidadPlanificada: number }[];
    }>(`/api/cirugias/${creada.cuerpo.cirugia.id}`);

    expect(despues.cuerpo.descartables[0]?.cantidadPlanificada).toBe(cantidadOriginal);
    expect(despues.cuerpo.cajas.map((c) => c.codigo)).not.toContain('CX-04');
  });

  it('crea la cirugia igual si no hay plantilla, pero lo avisa', async () => {
    const res = await api<{ sinPlantilla: boolean; cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-CX-03',
        procedimientoId: 'cx-proc2',
        cirujanoId: 'cx-sosa',
        programadaPara: hace(-60),
      },
    });

    expect(res.estado).toBe(201);
    expect(res.cuerpo.sinPlantilla).toBe(true);

    const detalle = await api<{ cajas: unknown[] }>(`/api/cirugias/${res.cuerpo.cirugia.id}`);
    expect(detalle.cuerpo.cajas).toHaveLength(0);
  });

  it('no guarda ningun dato clinico del paciente', async () => {
    const res = await api<{ cirugia: Record<string, unknown> }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-CX-04',
        procedimientoId: 'cx-proc',
        cirujanoId: 'cx-sosa',
        programadaPara: hace(-60),
        nombre: 'Juan Perez',
        diagnostico: 'colelitiasis',
      },
    });

    const claves = Object.keys(res.cuerpo.cirugia);
    expect(claves).not.toContain('nombre');
    expect(claves).not.toContain('diagnostico');
    expect(res.cuerpo.cirugia['pacienteRef']).toBe('PAC-CX-04');
  });
});

describe('preparacion y asignacion de cajas', () => {
  async function cirugiaConCajaLista(
    pacienteRef: string,
    codigoCaja: string,
  ): Promise<{ cirugiaId: string; cajaId: string }> {
    const cajaId = await crearCaja(codigoCaja);
    await api('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'cx-proc2',
        cirujanoId: 'cx-sosa',
        cajas: [{ cajaId }],
        descartables: [],
      },
    });

    const creada = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef,
        procedimientoId: 'cx-proc2',
        cirujanoId: 'cx-sosa',
        programadaPara: hace(-60),
      },
    });
    return { cirugiaId: creada.cuerpo.cirugia.id, cajaId };
  }

  it('preparar asigna las cajas del deposito esteril', async () => {
    const { cirugiaId } = await cirugiaConCajaLista('PAC-CX-10', 'CX-10');

    const res = await api<{ cajasAsignadas: string[]; cajasConProblema: unknown[] }>(
      `/api/cirugias/${cirugiaId}/estado`,
      { metodo: 'POST', token, cuerpo: { estado: 'preparada' } },
    );

    expect(res.estado).toBe(200);
    expect(res.cuerpo.cajasAsignadas).toEqual(['CX-10']);
    expect(res.cuerpo.cajasConProblema).toHaveLength(0);

    const caja = await api<{ estado: string }>('/api/cajas/CX-10');
    expect(caja.cuerpo.estado).toBe('asignada');
  });

  it('informa las cajas que no estan disponibles sin frenar al resto', async () => {
    const { cirugiaId, cajaId } = await cirugiaConCajaLista('PAC-CX-11', 'CX-11');
    const otraId = await crearCaja('CX-12');
    await api(`/api/cirugias/${cirugiaId}/cajas`, {
      metodo: 'POST',
      token,
      cuerpo: { cajaRef: otraId },
    });

    // CX-11 se ensucia antes de preparar.
    await moverCaja(cajaId, USUARIO, token, [['esteril_deposito', 'en_lavado']]);

    const res = await api<{
      cajasAsignadas: string[];
      cajasConProblema: { codigo: string; motivo: string }[];
    }>(`/api/cirugias/${cirugiaId}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'preparada' },
    });

    expect(res.cuerpo.cajasAsignadas).toEqual(['CX-12']);
    expect(res.cuerpo.cajasConProblema).toHaveLength(1);
    expect(res.cuerpo.cajasConProblema[0]?.codigo).toBe('CX-11');
  });

  it('no asigna una caja con la esterilidad vencida', async () => {
    const { cirugiaId, cajaId } = await cirugiaConCajaLista('PAC-CX-13', 'CX-13');
    await env.DB.prepare("update caja set vence_el = '2026-01-01T00:00:00.000Z' where id = ?")
      .bind(cajaId)
      .run();

    const res = await api<{ cajasConProblema: { motivo: string }[] }>(
      `/api/cirugias/${cirugiaId}/estado`,
      { metodo: 'POST', token, cuerpo: { estado: 'preparada' } },
    );

    expect(res.cuerpo.cajasConProblema[0]?.motivo).toContain('vencida');
  });

  it('se pueden agregar y quitar cajas fuera de la plantilla', async () => {
    const { cirugiaId } = await cirugiaConCajaLista('PAC-CX-14', 'CX-14');
    await crearCaja('CX-15');

    const agregada = await api<{ cajas: { codigo: string }[] }>(
      `/api/cirugias/${cirugiaId}/cajas`,
      { metodo: 'POST', token, cuerpo: { cajaRef: 'CX-15' } },
    );
    expect(agregada.cuerpo.cajas.map((c) => c.codigo)).toContain('CX-15');

    const quitada = await api<{ cajas: { codigo: string }[] }>(
      `/api/cirugias/${cirugiaId}/cajas/CX-15`,
      { metodo: 'DELETE', token },
    );
    expect(quitada.cuerpo.cajas.map((c) => c.codigo)).not.toContain('CX-15');
  });

  it('marca una caja como efectivamente usada', async () => {
    const { cirugiaId } = await cirugiaConCajaLista('PAC-CX-16', 'CX-16');

    const res = await api<{ cajas: { codigo: string; usada: boolean }[] }>(
      `/api/cirugias/${cirugiaId}/cajas`,
      { metodo: 'POST', token, cuerpo: { cajaRef: 'CX-16', usada: true } },
    );
    expect(res.cuerpo.cajas.find((c) => c.codigo === 'CX-16')?.usada).toBe(true);
  });
});

describe('estados de la cirugia', () => {
  async function nuevaCirugia(pacienteRef: string): Promise<string> {
    const res = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef,
        procedimientoId: 'cx-proc2',
        cirujanoId: 'cx-bianchi',
        programadaPara: hace(-60),
      },
    });
    return res.cuerpo.cirugia.id;
  }

  it('recorre el ciclo completo', async () => {
    const id = await nuevaCirugia('PAC-CX-20');
    for (const estado of ['preparada', 'en_curso', 'finalizada']) {
      const res = await api(`/api/cirugias/${id}/estado`, {
        metodo: 'POST',
        token,
        cuerpo: { estado },
      });
      expect(res.estado).toBe(200);
    }

    const detalle = await api<{ estado: string }>(`/api/cirugias/${id}`);
    expect(detalle.cuerpo.estado).toBe('finalizada');
  });

  it('rechaza saltear estados', async () => {
    const id = await nuevaCirugia('PAC-CX-21');
    const res = await api<{ error: string }>(`/api/cirugias/${id}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'finalizada' },
    });
    expect(res.estado).toBe(422);
    expect(res.cuerpo.error).toBe('transicion_cirugia_invalida');
  });

  it('una cirugia finalizada es terminal', async () => {
    const id = await nuevaCirugia('PAC-CX-22');
    for (const estado of ['preparada', 'en_curso', 'finalizada']) {
      await api(`/api/cirugias/${id}/estado`, { metodo: 'POST', token, cuerpo: { estado } });
    }

    const res = await api(`/api/cirugias/${id}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'suspendida' },
    });
    expect(res.estado).toBe(422);
  });

  it('una suspendida se reprograma en vez de crear otra', async () => {
    // Crear una cirugia nueva perderia el vinculo con las cajas ya preparadas.
    const id = await nuevaCirugia('PAC-CX-23');
    await api(`/api/cirugias/${id}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'suspendida' },
    });

    const res = await api(`/api/cirugias/${id}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'programada' },
    });
    expect(res.estado).toBe(200);
  });
});

describe('trazabilidad de una cirugia', () => {
  it('devuelve los movimientos, el ciclo de cada caja y los consumos', async () => {
    const cajaId = await crearCaja('CX-30');
    await api('/api/plantillas', {
      metodo: 'POST',
      token,
      cuerpo: {
        procedimientoId: 'cx-proc2',
        cirujanoId: 'cx-bianchi',
        cajas: [{ cajaId }],
        descartables: [],
      },
    });

    const creada = await api<{ cirugia: { id: string } }>('/api/cirugias', {
      metodo: 'POST',
      token,
      cuerpo: {
        pacienteRef: 'PAC-CX-30',
        procedimientoId: 'cx-proc2',
        cirujanoId: 'cx-bianchi',
        programadaPara: hace(-60),
      },
    });
    const cirugiaId = creada.cuerpo.cirugia.id;

    await api(`/api/cirugias/${cirugiaId}/estado`, {
      metodo: 'POST',
      token,
      cuerpo: { estado: 'preparada' },
    });

    const res = await api<{
      movimientos: { codigo: string; estadoHasta: string; usuario: string }[];
      ciclos: unknown[];
      consumos: unknown[];
    }>(`/api/cirugias/${cirugiaId}/trazabilidad`);

    expect(res.estado).toBe(200);
    expect(res.cuerpo.movimientos).toHaveLength(1);
    expect(res.cuerpo.movimientos[0]?.codigo).toBe('CX-30');
    expect(res.cuerpo.movimientos[0]?.estadoHasta).toBe('asignada');
    expect(res.cuerpo.movimientos[0]?.usuario).toBe(`Usuaria ${USUARIO}`);
  });

  it('404 si la cirugia no existe', async () => {
    const res = await api('/api/cirugias/no-existe/trazabilidad');
    expect(res.estado).toBe(404);
  });
});
