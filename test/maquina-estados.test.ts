import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { ESTADOS_CAJA, TRANSICIONES, transicionesPlanas } from '../src/dominio/estados';
import {
  contarMovimientos,
  crearCaja,
  crearCiclo,
  esperarAbort,
  estadoDe,
  mover,
  nuevoId,
  sembrarBase,
} from './ayudas';

beforeEach(async () => {
  await sembrarBase();
});

describe('la maquina de estados de la base coincide con la del codigo', () => {
  it('la tabla transicion_valida tiene exactamente las aristas de TRANSICIONES', async () => {
    const { results } = await env.DB.prepare(
      'select estado_desde, estado_hasta from transicion_valida order by estado_desde, estado_hasta',
    ).all<{ estado_desde: string; estado_hasta: string }>();

    const enBase = results.map((f) => `${f.estado_desde}>${f.estado_hasta}`).sort();
    const enCodigo = transicionesPlanas()
      .map((t) => `${t.estadoDesde}>${t.estadoHasta}`)
      .sort();

    expect(enBase).toEqual(enCodigo);
  });
});

describe('transiciones validas', () => {
  it('recorre el ciclo completo de una caja', async () => {
    await crearCaja('c1');
    await crearCiclo('ciclo-ok', 'c1', 'conforme');

    await mover('c1', 'esteril_deposito', 'asignada');
    expect(await estadoDe('c1')).toBe('asignada');

    await mover('c1', 'asignada', 'en_quirofano');
    await mover('c1', 'en_quirofano', 'usada_sucia');
    await mover('c1', 'usada_sucia', 'en_lavado');
    await mover('c1', 'en_lavado', 'en_armado');
    await mover('c1', 'en_armado', 'en_esterilizacion', { cicloId: 'ciclo-ok' });
    await mover('c1', 'en_esterilizacion', 'en_cuarentena', { cicloId: 'ciclo-ok' });
    await mover('c1', 'en_cuarentena', 'esteril_deposito', { cicloId: 'ciclo-ok' });

    expect(await estadoDe('c1')).toBe('esteril_deposito');
    expect(await contarMovimientos('c1')).toBe(8);
  });

  it('cuenta un ciclo de vida cada vez que la caja entra al autoclave', async () => {
    await crearCaja('c2');
    await crearCiclo('ciclo-c2', 'c2', 'conforme');

    await mover('c2', 'esteril_deposito', 'en_lavado');
    await mover('c2', 'en_lavado', 'en_armado');
    await mover('c2', 'en_armado', 'en_esterilizacion', { cicloId: 'ciclo-c2' });

    const fila = await env.DB.prepare('select ciclos_totales from caja where id = ?')
      .bind('c2')
      .first<{ ciclos_totales: number }>();
    expect(fila?.ciclos_totales).toBe(1);
  });
});

describe('transiciones invalidas', () => {
  it('rechaza una arista que no existe en la maquina de estados', async () => {
    await crearCaja('c3');
    await esperarAbort(
      () => mover('c3', 'esteril_deposito', 'en_armado'),
      'transicion_invalida',
    );
    expect(await estadoDe('c3')).toBe('esteril_deposito');
  });

  it('rechaza saltear el lavado despues de una cirugia', async () => {
    await crearCaja('c4');
    await mover('c4', 'esteril_deposito', 'asignada');
    await mover('c4', 'asignada', 'en_quirofano');
    await mover('c4', 'en_quirofano', 'usada_sucia');

    await esperarAbort(() => mover('c4', 'usada_sucia', 'en_esterilizacion'), 'transicion_invalida');
    expect(await estadoDe('c4')).toBe('usada_sucia');
  });

  it('baja es terminal: no hay salida', async () => {
    await crearCaja('c5');
    await mover('c5', 'esteril_deposito', 'en_lavado');
    await mover('c5', 'en_lavado', 'en_armado');
    await mover('c5', 'en_armado', 'en_reparacion');
    await mover('c5', 'en_reparacion', 'baja');
    expect(await estadoDe('c5')).toBe('baja');

    for (const destino of ESTADOS_CAJA) {
      if (destino === 'baja') continue;
      await esperarAbort(() => mover('c5', 'baja', destino), 'transicion_invalida');
    }
    expect(TRANSICIONES.baja).toHaveLength(0);
  });

  it('rechaza el evento cuyo estado_desde no es el estado actual', async () => {
    await crearCaja('c6');
    // La caja esta en esteril_deposito, pero el evento dice venir de en_lavado.
    // La arista en_lavado -> en_armado es valida, asi que lo unico que puede
    // fallar aca es el chequeo de estado actual.
    await esperarAbort(() => mover('c6', 'en_lavado', 'en_armado'), 'conflicto_estado');
    expect(await estadoDe('c6')).toBe('esteril_deposito');
  });
});

describe('idempotencia de la sincronizacion offline', () => {
  it('reenviar el mismo evento no duplica nada', async () => {
    await crearCaja('c7');
    const id = nuevoId('mov');

    await mover('c7', 'esteril_deposito', 'en_lavado', { id });
    await mover('c7', 'esteril_deposito', 'en_lavado', { id });

    expect(await contarMovimientos('c7')).toBe(1);
    expect(await estadoDe('c7')).toBe('en_lavado');
  });

  it('reenviar un evento viejo despues de que la caja avanzo tampoco falla', async () => {
    // Este es el caso que rompe si el trigger de validacion no lleva la guarda
    // de idempotencia: la caja ya paso a en_armado, el reintento del primer
    // evento parece una transicion invalida y aborta.
    await crearCaja('c8');
    const primero = nuevoId('mov');

    await mover('c8', 'esteril_deposito', 'en_lavado', { id: primero });
    await mover('c8', 'en_lavado', 'en_armado');

    await mover('c8', 'esteril_deposito', 'en_lavado', { id: primero });

    expect(await contarMovimientos('c8')).toBe(2);
    expect(await estadoDe('c8')).toBe('en_armado');
  });

  it('OR IGNORE no tapa una transicion realmente invalida', async () => {
    // La idempotencia no puede convertirse en un descarte silencioso: un
    // evento nuevo con una transicion ilegal tiene que seguir explotando para
    // que la usuaria vea el conflicto.
    await crearCaja('c9');
    await mover('c9', 'esteril_deposito', 'en_lavado');
    await mover('c9', 'en_lavado', 'en_armado');

    await esperarAbort(
      () => mover('c9', 'en_armado', 'esteril_deposito'),
      'transicion_invalida',
    );
    expect(await contarMovimientos('c9')).toBe(2);
  });
});

describe('vencimiento de la esterilidad', () => {
  it('no se puede asignar una caja vencida', async () => {
    await crearCaja('c10', { venceEl: '2026-01-31T00:00:00.000Z' });
    await esperarAbort(
      () => mover('c10', 'esteril_deposito', 'asignada', { ocurridoEn: '2026-08-10T09:00:00.000Z' }),
      'caja_vencida',
    );
  });

  it('un escaneo offline anterior al vencimiento sigue siendo valido', async () => {
    // El escaneo ocurrio cuando la caja todavia estaba vigente; que se
    // sincronice tarde no lo invalida.
    await crearCaja('c11', { venceEl: '2026-08-05T00:00:00.000Z' });
    await mover('c11', 'esteril_deposito', 'asignada', { ocurridoEn: '2026-08-01T09:00:00.000Z' });
    expect(await estadoDe('c11')).toBe('asignada');
  });

  it('una caja vencida si puede ir a lavado', async () => {
    await crearCaja('c12', { venceEl: '2026-01-31T00:00:00.000Z' });
    await mover('c12', 'esteril_deposito', 'en_lavado');
    expect(await estadoDe('c12')).toBe('en_lavado');
  });

  it('no se puede asignar una caja dada de baja', async () => {
    await crearCaja('c13', { activa: 0 });
    await esperarAbort(() => mover('c13', 'esteril_deposito', 'asignada'), 'caja_inactiva');
  });
});

describe('control biologico: salida de cuarentena', () => {
  async function llevarACuarentena(cajaId: string, cicloId: string): Promise<void> {
    await mover(cajaId, 'esteril_deposito', 'en_lavado');
    await mover(cajaId, 'en_lavado', 'en_armado');
    await mover(cajaId, 'en_armado', 'en_esterilizacion', { cicloId });
    await mover(cajaId, 'en_esterilizacion', 'en_cuarentena', { cicloId });
  }

  it('bloquea la liberacion si el control biologico esta pendiente', async () => {
    await crearCaja('c14');
    await crearCiclo('ciclo-pend', 'c14', 'pendiente');
    await llevarACuarentena('c14', 'ciclo-pend');

    await esperarAbort(
      () => mover('c14', 'en_cuarentena', 'esteril_deposito', { cicloId: 'ciclo-pend' }),
      'control_biologico_no_conforme',
    );
    expect(await estadoDe('c14')).toBe('en_cuarentena');
  });

  it('bloquea la liberacion si el control biologico salio no conforme', async () => {
    await crearCaja('c15');
    await crearCiclo('ciclo-malo', 'c15', 'no_conforme');
    await llevarACuarentena('c15', 'ciclo-malo');

    await esperarAbort(
      () => mover('c15', 'en_cuarentena', 'esteril_deposito', { cicloId: 'ciclo-malo' }),
      'control_biologico_no_conforme',
    );
  });

  it('permite volver a lavado cuando el ciclo salio no conforme', async () => {
    await crearCaja('c16');
    await crearCiclo('ciclo-malo-2', 'c16', 'no_conforme');
    await llevarACuarentena('c16', 'ciclo-malo-2');

    await mover('c16', 'en_cuarentena', 'en_lavado');
    expect(await estadoDe('c16')).toBe('en_lavado');
  });

  it('libera cuando el control biologico es conforme', async () => {
    await crearCaja('c17');
    await crearCiclo('ciclo-bueno', 'c17', 'conforme');
    await llevarACuarentena('c17', 'ciclo-bueno');

    await mover('c17', 'en_cuarentena', 'esteril_deposito', { cicloId: 'ciclo-bueno' });
    expect(await estadoDe('c17')).toBe('esteril_deposito');
  });

  it('el ciclo que manda es el ultimo, no uno viejo que estaba conforme', async () => {
    // Una caja que ya paso por un ciclo conforme no puede colarse por la
    // historia: lo que decide es el ciclo mas reciente.
    await crearCaja('c18');
    await crearCiclo('ciclo-viejo', 'c18', 'conforme', '2026-07-01T10:00:00.000Z');
    await crearCiclo('ciclo-nuevo', 'c18', 'pendiente', '2026-08-09T10:00:00.000Z');
    await llevarACuarentena('c18', 'ciclo-nuevo');

    await esperarAbort(
      () => mover('c18', 'en_cuarentena', 'esteril_deposito'),
      'control_biologico_no_conforme',
    );
  });

  it('el recall alcanza a una caja que ya estaba asignada', async () => {
    // Sin la arista asignada -> en_lavado esta caja quedaba atrapada: no habia
    // forma de retirarla del circuito.
    await crearCaja('c19');
    await mover('c19', 'esteril_deposito', 'asignada');
    await mover('c19', 'asignada', 'en_lavado');
    expect(await estadoDe('c19')).toBe('en_lavado');
  });
});
