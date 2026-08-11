import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { contarMovimientos, crearCaja, esperarAbort, estadoDe, mover, sembrarBase } from './ayudas';

beforeEach(async () => {
  await sembrarBase();
});

describe('movimiento_caja es append-only', () => {
  it('no admite UPDATE ni por SQL directo', async () => {
    await crearCaja('i1');
    const id = await mover('i1', 'esteril_deposito', 'en_lavado');

    await esperarAbort(
      () =>
        env.DB.prepare('update movimiento_caja set observacion = ? where id = ?')
          .bind('editado a mano', id)
          .run(),
      'append_only',
    );
  });

  it('no admite DELETE ni por SQL directo', async () => {
    await crearCaja('i2');
    const id = await mover('i2', 'esteril_deposito', 'en_lavado');

    await esperarAbort(
      () => env.DB.prepare('delete from movimiento_caja where id = ?').bind(id).run(),
      'append_only',
    );
    expect(await contarMovimientos('i2')).toBe(1);
  });

  it('tampoco se puede vaciar la tabla entera', async () => {
    await crearCaja('i3');
    await mover('i3', 'esteril_deposito', 'en_lavado');

    await esperarAbort(() => env.DB.prepare('delete from movimiento_caja').run(), 'append_only');
    expect(await contarMovimientos('i3')).toBe(1);
  });
});

describe('caja.estado solo cambia por INSERT en movimiento_caja', () => {
  it('rechaza un UPDATE directo del estado', async () => {
    await crearCaja('i4');

    await esperarAbort(
      () => env.DB.prepare("update caja set estado = 'en_lavado' where id = ?").bind('i4').run(),
      'estado_no_modificable',
    );
    expect(await estadoDe('i4')).toBe('esteril_deposito');
  });

  it('un UPDATE que reescribe el mismo estado no molesta', async () => {
    // No es un agujero: escribir el valor que ya estaba no cambia nada, y
    // abortar ahi romperia cualquier UPDATE masivo que toque la columna sin
    // querer modificarla.
    await crearCaja('i4b');
    await env.DB.prepare("update caja set estado = 'esteril_deposito' where id = ?")
      .bind('i4b')
      .run();
    expect(await estadoDe('i4b')).toBe('esteril_deposito');
  });

  it('rechaza un UPDATE que pretende una transicion valida pero sin evento', async () => {
    await crearCaja('i5');

    await esperarAbort(
      () => env.DB.prepare("update caja set estado = 'asignada' where id = ?").bind('i5').run(),
      'estado_no_modificable',
    );
    expect(await estadoDe('i5')).toBe('esteril_deposito');
  });

  it('no se puede reusar un movimiento viejo para justificar un cambio de estado', async () => {
    // La caja vuelve a esteril_deposito despues de un ciclo completo. En el
    // historial ya existe un esteril_deposito -> en_lavado, pero no es el
    // ultimo movimiento, asi que no sirve como justificacion.
    await crearCaja('i6');
    await mover('i6', 'esteril_deposito', 'en_lavado');
    await mover('i6', 'en_lavado', 'en_armado');
    await mover('i6', 'en_armado', 'en_reparacion');
    await mover('i6', 'en_reparacion', 'en_armado');

    await esperarAbort(
      () => env.DB.prepare("update caja set estado = 'en_esterilizacion' where id = ?").bind('i6').run(),
      'estado_no_modificable',
    );
    expect(await estadoDe('i6')).toBe('en_armado');
  });

  it('permite editar otras columnas de la caja sin tocar el estado', async () => {
    await crearCaja('i7');
    await env.DB.prepare('update caja set ubicacion = ? where id = ?')
      .bind('Estante nuevo', 'i7')
      .run();

    const fila = await env.DB.prepare('select ubicacion, estado from caja where id = ?')
      .bind('i7')
      .first<{ ubicacion: string; estado: string }>();
    expect(fila?.ubicacion).toBe('Estante nuevo');
    expect(fila?.estado).toBe('esteril_deposito');
  });
});

describe('los controles de un ciclo no se reescriben', () => {
  async function cicloPendiente(id: string): Promise<void> {
    await env.DB.prepare(
      `insert into ciclo_esterilizacion
         (id, numero_lote, equipo_id, metodo, iniciado_en, control_biologico, operador_id)
       values (?, ?, 'eq-test', 'vapor_134', '2026-08-09T15:00:00.000Z', 'pendiente', 'u-test')`,
    )
      .bind(id, `L-${id}`)
      .run();
  }

  async function cargarBiologico(id: string, resultado: string): Promise<void> {
    await env.DB.prepare('update ciclo_esterilizacion set control_biologico = ? where id = ?')
      .bind(resultado, id)
      .run();
  }

  it('se puede cargar el resultado cuando esta pendiente', async () => {
    await cicloPendiente('ci-1');
    await cargarBiologico('ci-1', 'no_conforme');

    const fila = await env.DB.prepare(
      'select control_biologico from ciclo_esterilizacion where id = ?',
    )
      .bind('ci-1')
      .first<{ control_biologico: string }>();
    expect(fila?.control_biologico).toBe('no_conforme');
  });

  it('no se puede maquillar un no conforme despues de cargado', async () => {
    await cicloPendiente('ci-2');
    await cargarBiologico('ci-2', 'no_conforme');

    await esperarAbort(() => cargarBiologico('ci-2', 'conforme'), 'control_ya_registrado');
  });

  it('tampoco se puede volver un conforme a pendiente', async () => {
    await cicloPendiente('ci-3');
    await cargarBiologico('ci-3', 'conforme');

    await esperarAbort(() => cargarBiologico('ci-3', 'pendiente'), 'control_ya_registrado');
  });
});
