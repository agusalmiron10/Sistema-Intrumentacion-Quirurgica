import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { hashPin } from '../src/auth/pin';

const BASE = 'https://test.local';
const PIN = '5150';

/** Los eventos no pueden tener fecha futura: el servidor los rechaza por reloj desfasado. */
const hace = (minutos: number): string => new Date(Date.now() - minutos * 60_000).toISOString();

let tokenOperador = '';
let tokenSupervisor = '';
let contador = 0;

async function crearUsuario(id: string, rol: string): Promise<void> {
  await env.DB.prepare(
    `insert or replace into usuario (id, nombre, email, pin_hash, rol, intentos_fallidos, bloqueado_hasta)
     values (?, ?, ?, ?, ?, 0, null)`,
  )
    .bind(id, `Usuaria ${id}`, `${id}@hospital.local`, await hashPin(PIN), rol)
    .run();
}

async function ingresar(usuarioId: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuarioId, pin: PIN }),
  });
  return (await res.json<{ token: string }>()).token;
}

async function api<T>(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; token?: string } = {},
): Promise<{ estado: number; cuerpo: T }> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opciones.token) cabeceras['Authorization'] = `Bearer ${opciones.token}`;

  const res = await SELF.fetch(`${BASE}${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers: cabeceras,
    ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
  });
  const texto = await res.text();
  return { estado: res.status, cuerpo: (texto ? JSON.parse(texto) : null) as T };
}

/** Deja una caja lista para entrar al autoclave. */
async function cajaEnArmado(codigo: string): Promise<string> {
  const creada = await api<{ id: string }>('/api/cajas', {
    metodo: 'POST',
    cuerpo: { codigo, nombre: `Caja ${codigo}` },
  });
  const id = creada.cuerpo.id;

  const eventos = [
    { desde: 'esteril_deposito', hasta: 'en_lavado' },
    { desde: 'en_lavado', hasta: 'en_armado' },
  ].map((paso, i) => ({
    id: crypto.randomUUID(),
    cajaRef: id,
    usuarioId: 'ci-operador',
    estadoDesde: paso.desde,
    estadoHasta: paso.hasta,
    ocurridoEn: new Date(Date.parse('2026-08-10T06:00:00.000Z') + i * 60_000).toISOString(),
  }));

  await api('/api/eventos', { metodo: 'POST', cuerpo: { eventos }, token: tokenOperador });
  return id;
}

interface Ciclo {
  id: string;
  numeroLote: string;
  controlBiologico: string;
  liberadoEn: string | null;
  finalizadoEn: string | null;
}

async function cicloCon(codigos: string[]): Promise<Ciclo> {
  contador += 1;
  for (const codigo of codigos) await cajaEnArmado(codigo);

  const res = await api<Ciclo>('/api/ciclos', {
    metodo: 'POST',
    token: tokenOperador,
    cuerpo: {
      numeroLote: `2026-T${String(contador).padStart(3, '0')}`,
      equipoId: 'ci-equipo',
      metodo: 'vapor_134',
      iniciadoEn: '2026-08-10T08:00:00.000Z',
      cajaRefs: codigos,
    },
  });
  expect(res.estado).toBe(201);
  return res.cuerpo;
}

beforeAll(async () => {
  await crearUsuario('ci-operador', 'esterilizacion');
  await crearUsuario('ci-supervisor', 'supervisor');
  tokenOperador = await ingresar('ci-operador');
  tokenSupervisor = await ingresar('ci-supervisor');

  await env.DB.prepare(
    `insert or ignore into equipo_esterilizador (id, nombre, marca) values ('ci-equipo', 'Autoclave test', 'Getinge')`,
  ).run();
});

describe('armado del ciclo', () => {
  it('carga las cajas y las pone en esterilizacion', async () => {
    const ciclo = await cicloCon(['CI-01', 'CI-02']);

    const detalle = await api<{ cajas: { codigo: string; estado: string }[] }>(
      `/api/ciclos/${ciclo.id}`,
    );
    expect(detalle.cuerpo.cajas).toHaveLength(2);
    expect(detalle.cuerpo.cajas.every((c) => c.estado === 'en_esterilizacion')).toBe(true);
  });

  it('no arma el ciclo si alguna caja no esta en armado', async () => {
    // Cargar un autoclave a medias y descubrirlo despues significa no saber
    // que habia adentro.
    await cajaEnArmado('CI-03');
    await api('/api/cajas', { metodo: 'POST', cuerpo: { codigo: 'CI-04', nombre: 'Sin lavar' } });

    const res = await api<{ error: string; detalle: { noListas: { codigo: string }[] } }>(
      '/api/ciclos',
      {
        metodo: 'POST',
        token: tokenOperador,
        cuerpo: {
          numeroLote: '2026-FALLA',
          equipoId: 'ci-equipo',
          metodo: 'vapor_134',
          iniciadoEn: '2026-08-10T08:00:00.000Z',
          cajaRefs: ['CI-03', 'CI-04'],
        },
      },
    );

    expect(res.estado).toBe(422);
    expect(res.cuerpo.error).toBe('cajas_no_listas');
    expect(res.cuerpo.detalle.noListas[0]?.codigo).toBe('CI-04');

    // CI-03 tiene que seguir intacta en armado.
    const caja = await api<{ estado: string }>('/api/cajas/CI-03');
    expect(caja.cuerpo.estado).toBe('en_armado');
  });

  it('exige numero de lote unico', async () => {
    const ciclo = await cicloCon(['CI-05']);
    await cajaEnArmado('CI-06');

    const res = await api<{ error: string }>('/api/ciclos', {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {
        numeroLote: ciclo.numeroLote,
        equipoId: 'ci-equipo',
        metodo: 'vapor_134',
        iniciadoEn: '2026-08-10T08:00:00.000Z',
        cajaRefs: ['CI-06'],
      },
    });
    expect(res.estado).toBe(409);
  });

  it('necesita sesion', async () => {
    const res = await api('/api/ciclos', {
      metodo: 'POST',
      cuerpo: {
        numeroLote: 'X',
        equipoId: 'ci-equipo',
        metodo: 'vapor_134',
        iniciadoEn: '2026-08-10T08:00:00.000Z',
        cajaRefs: ['CI-01'],
      },
    });
    expect(res.estado).toBe(401);
  });
});

describe('cuarentena y liberacion', () => {
  it('al finalizar el ciclo las cajas quedan en cuarentena', async () => {
    const ciclo = await cicloCon(['CI-10']);

    const res = await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z', temperaturaC: 134, tiempoMin: 45 },
    });
    expect(res.estado).toBe(200);

    const caja = await api<{ estado: string }>('/api/cajas/CI-10');
    expect(caja.cuerpo.estado).toBe('en_cuarentena');
  });

  it('no se libera con el biologico pendiente', async () => {
    const ciclo = await cicloCon(['CI-11']);
    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });

    const res = await api<{ error: string }>(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenSupervisor,
      cuerpo: {},
    });
    expect(res.estado).toBe(422);
    expect(res.cuerpo.error).toBe('controles_incompletos');

    const caja = await api<{ estado: string }>('/api/cajas/CI-11');
    expect(caja.cuerpo.estado).toBe('en_cuarentena');
  });

  it('libera con los tres controles conformes y fija el vencimiento', async () => {
    const ciclo = await cicloCon(['CI-12']);
    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });
    await api(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {
        controlFisico: 'conforme',
        controlQuimico: 'conforme',
        controlBiologico: 'conforme',
      },
    });

    const res = await api<{ liberadas: string[] }>(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenSupervisor,
      cuerpo: { liberadoEn: '2026-08-11T08:00:00.000Z', diasVigencia: 180 },
    });
    expect(res.estado).toBe(200);
    expect(res.cuerpo.liberadas).toEqual(['CI-12']);

    const caja = await api<{ estado: string; venceEl: string }>('/api/cajas/CI-12');
    expect(caja.cuerpo.estado).toBe('esteril_deposito');
    expect(caja.cuerpo.venceEl.slice(0, 10)).toBe('2027-02-07');
  });

  it('la liberacion la firma un supervisor, no cualquiera', async () => {
    const ciclo = await cicloCon(['CI-13']);
    const res = await api<{ error: string }>(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {},
    });
    expect(res.estado).toBe(403);
    expect(res.cuerpo.error).toBe('rol_insuficiente');
  });

  it('no se libera dos veces', async () => {
    const ciclo = await cicloCon(['CI-14']);
    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });
    await api(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {
        controlFisico: 'conforme',
        controlQuimico: 'conforme',
        controlBiologico: 'conforme',
      },
    });
    await api(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenSupervisor,
      cuerpo: {},
    });

    const segunda = await api<{ error: string }>(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenSupervisor,
      cuerpo: {},
    });
    expect(segunda.estado).toBe(422);
    expect(segunda.cuerpo.error).toBe('ciclo_ya_liberado');
  });
});

describe('control biologico no conforme', () => {
  it('retira todo el lote a lavado automaticamente', async () => {
    const ciclo = await cicloCon(['CI-20', 'CI-21', 'CI-22']);
    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });

    const res = await api<{ recall: { cajas: { codigo: string; accion: string }[] } }>(
      `/api/ciclos/${ciclo.id}/controles`,
      {
        metodo: 'POST',
        token: tokenOperador,
        cuerpo: { controlBiologico: 'no_conforme' },
      },
    );

    expect(res.estado).toBe(200);
    expect(res.cuerpo.recall.cajas).toHaveLength(3);
    expect(res.cuerpo.recall.cajas.every((c) => c.accion === 'retirada')).toBe(true);

    for (const codigo of ['CI-20', 'CI-21', 'CI-22']) {
      const caja = await api<{ estado: string; venceEl: string | null }>(`/api/cajas/${codigo}`);
      expect(caja.cuerpo.estado).toBe('en_lavado');
      // La esterilidad de una caja de un lote contaminado no vale nada.
      expect(caja.cuerpo.venceEl).toBeNull();
    }
  });

  it('alcanza tambien a las cajas ya liberadas y asignadas', async () => {
    // El caso peor: el biologico tarda y para cuando llega el resultado las
    // cajas ya volvieron al deposito y una esta comprometida con una cirugia.
    const ciclo = await cicloCon(['CI-30', 'CI-31']);
    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });
    await api(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { controlFisico: 'conforme', controlQuimico: 'conforme' },
    });
    // Se libera provisoriamente con el biologico pendiente? No: se fuerza el
    // recorrido moviendo las cajas a mano, que es lo que pasa cuando el
    // deposito las saca antes de tiempo.
    const cajas = await api<{ cajas: { id: string; codigo: string }[] }>(
      `/api/ciclos/${ciclo.id}`,
    );

    await env.DB.prepare(
      `insert into ciclo_esterilizacion (id, numero_lote, equipo_id, metodo, iniciado_en, control_biologico, operador_id)
       values ('ci-dummy', 'ci-dummy-lote', 'ci-equipo', 'vapor_134', '2026-01-01T00:00:00.000Z', 'conforme', 'ci-operador')`,
    ).run();

    for (const caja of cajas.cuerpo.cajas) {
      // Se saca de cuarentena via un ciclo conforme ficticio mas reciente,
      // igual que si la hubiera liberado otro lote.
      await env.DB.prepare(
        `insert into ciclo_caja (ciclo_id, caja_id) values ('ci-dummy', ?)`,
      )
        .bind(caja.id)
        .run();
    }

    const eventos = cajas.cuerpo.cajas.map((caja) => ({
      id: crypto.randomUUID(),
      cajaRef: caja.id,
      usuarioId: 'ci-operador',
      estadoDesde: 'en_cuarentena',
      estadoHasta: 'esteril_deposito',
      ocurridoEn: hace(50),
    }));
    await api('/api/eventos', { metodo: 'POST', cuerpo: { eventos }, token: tokenOperador });

    // Una queda asignada a una cirugia.
    await api('/api/eventos', {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {
        eventos: [
          {
            id: crypto.randomUUID(),
            cajaRef: 'CI-30',
            usuarioId: 'ci-operador',
            estadoDesde: 'esteril_deposito',
            estadoHasta: 'asignada',
            ocurridoEn: hace(45),
          },
        ],
      },
    });

    const res = await api<{ recall: { cajas: { codigo: string; accion: string }[] } }>(
      `/api/ciclos/${ciclo.id}/controles`,
      { metodo: 'POST', token: tokenOperador, cuerpo: { controlBiologico: 'no_conforme' } },
    );

    expect(res.cuerpo.recall.cajas.every((c) => c.accion === 'retirada')).toBe(true);
    for (const codigo of ['CI-30', 'CI-31']) {
      const caja = await api<{ estado: string }>(`/api/cajas/${codigo}`);
      expect(caja.cuerpo.estado).toBe('en_lavado');
    }
  });

  it('no fuerza una caja que ya esta en quirofano, la reporta', async () => {
    const ciclo = await cicloCon(['CI-40']);
    const cajas = await api<{ cajas: { id: string }[] }>(`/api/ciclos/${ciclo.id}`);
    const cajaId = cajas.cuerpo.cajas[0]!.id;

    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });
    await api(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { controlFisico: 'conforme', controlQuimico: 'conforme', controlBiologico: 'conforme' },
    });
    await api(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenSupervisor,
      cuerpo: {},
    });

    const pasos = [
      ['esteril_deposito', 'asignada'],
      ['asignada', 'en_quirofano'],
    ];
    await api('/api/eventos', {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {
        eventos: pasos.map(([desde, hasta], i) => ({
          id: crypto.randomUUID(),
          cajaRef: cajaId,
          usuarioId: 'ci-operador',
          estadoDesde: desde,
          estadoHasta: hasta,
          ocurridoEn: new Date(Date.parse(hace(90)) + i * 60_000).toISOString(),
        })),
      },
    });

    const impacto = await api<{ cajas: { codigo: string; accion: string }[] }>(
      `/api/ciclos/${ciclo.id}/impacto`,
    );
    expect(impacto.cuerpo.cajas[0]?.accion).toBe('en_quirofano');

    // Sigue en quirofano: forzarla por sistema no la saca del campo quirurgico.
    const caja = await api<{ estado: string }>('/api/cajas/CI-40');
    expect(caja.cuerpo.estado).toBe('en_quirofano');
  });

  it('el control biologico no se puede reescribir', async () => {
    const ciclo = await cicloCon(['CI-50']);
    await api(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { controlBiologico: 'no_conforme' },
    });

    const res = await api<{ error: string }>(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { controlBiologico: 'conforme' },
    });
    expect(res.estado).toBe(409);
    expect(res.cuerpo.error).toBe('control_ya_registrado');
  });
});

describe('cirugias afectadas', () => {
  it('devuelve las cirugias que usaron cajas del lote', async () => {
    const ciclo = await cicloCon(['CI-60']);
    const cajas = await api<{ cajas: { id: string }[] }>(`/api/ciclos/${ciclo.id}`);
    const cajaId = cajas.cuerpo.cajas[0]!.id;

    await env.DB.batch([
      env.DB.prepare(
        `insert or ignore into procedimiento (id, nombre, codigo) values ('ci-proc', 'Colecistectomia', 'CI-COLE')`,
      ),
      env.DB.prepare(
        `insert or ignore into cirujano (id, nombre, matricula) values ('ci-ciru', 'Dr. Prueba', 'MN 00001')`,
      ),
      env.DB.prepare(
        `insert or ignore into cirugia (id, paciente_ref, procedimiento_id, cirujano_id, quirofano, programada_para, estado)
         values ('ci-cirugia', 'PAC-9911', 'ci-proc', 'ci-ciru', 'Q4', '2026-08-12T10:00:00.000Z', 'finalizada')`,
      ),
    ]);

    await api(`/api/ciclos/${ciclo.id}/finalizar`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { finalizadoEn: '2026-08-10T09:20:00.000Z' },
    });
    await api(`/api/ciclos/${ciclo.id}/controles`, {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: { controlFisico: 'conforme', controlQuimico: 'conforme', controlBiologico: 'conforme' },
    });
    await api(`/api/ciclos/${ciclo.id}/liberar`, {
      metodo: 'POST',
      token: tokenSupervisor,
      cuerpo: {},
    });

    await api('/api/eventos', {
      metodo: 'POST',
      token: tokenOperador,
      cuerpo: {
        eventos: [
          {
            id: crypto.randomUUID(),
            cajaRef: cajaId,
            usuarioId: 'ci-operador',
            estadoDesde: 'esteril_deposito',
            estadoHasta: 'asignada',
            ocurridoEn: hace(60),
            cirugiaId: 'ci-cirugia',
          },
        ],
      },
    });

    const impacto = await api<{
      cirugias: { id: string; pacienteRef: string; cajas: string[] }[];
    }>(`/api/ciclos/${ciclo.id}/impacto`);

    expect(impacto.cuerpo.cirugias).toHaveLength(1);
    expect(impacto.cuerpo.cirugias[0]?.pacienteRef).toBe('PAC-9911');
    expect(impacto.cuerpo.cirugias[0]?.cajas).toEqual(['CI-60']);
  });

  it('el impacto no escribe nada', async () => {
    const ciclo = await cicloCon(['CI-70']);
    await api(`/api/ciclos/${ciclo.id}/impacto`);

    const caja = await api<{ estado: string }>('/api/cajas/CI-70');
    expect(caja.cuerpo.estado).toBe('en_esterilizacion');
  });
});
