import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { esperarAbort, nuevoId, sembrarBase, USUARIO } from './ayudas';

/**
 * Fase 1: solo los invariantes que sostiene la base. El algoritmo de consumo
 * FEFO en si llega en la fase 6; aca se verifica que el orden de los lotes que
 * ese algoritmo va a consultar es el correcto y que el saldo no se puede
 * falsear.
 */

const AHORA = '2026-08-10T12:00:00.000Z';

async function crearDescartable(id: string): Promise<void> {
  await env.DB.prepare(
    `insert or ignore into descartable (id, nombre, codigo, unidad)
     values (?, 'Sutura de prueba', ?, 'unidad')`,
  )
    .bind(id, id.toUpperCase())
    .run();
}

async function crearLote(
  id: string,
  descartableId: string,
  venceEl: string | null,
  cantidadInicial: number,
): Promise<void> {
  await env.DB.prepare(
    `insert into lote_descartable (id, descartable_id, numero_lote, vence_el, cantidad_inicial, cantidad_actual)
     values (?, ?, ?, ?, ?, 0)`,
  )
    .bind(id, descartableId, `L-${id}`, venceEl, cantidadInicial)
    .run();

  if (cantidadInicial > 0) {
    await movimiento(id, 'ingreso', cantidadInicial);
  }
}

async function movimiento(
  loteId: string,
  tipo: 'ingreso' | 'consumo' | 'devolucion' | 'vencido' | 'ajuste',
  cantidad: number,
  id = nuevoId('ms'),
): Promise<string> {
  await env.DB.prepare(
    `insert or ignore into movimiento_stock (id, lote_id, tipo, cantidad, usuario_id, ocurrido_en)
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, loteId, tipo, cantidad, USUARIO, AHORA)
    .run();
  return id;
}

async function saldo(loteId: string): Promise<number> {
  const fila = await env.DB.prepare('select cantidad_actual from lote_descartable where id = ?')
    .bind(loteId)
    .first<{ cantidad_actual: number }>();
  return fila?.cantidad_actual ?? -1;
}

beforeEach(async () => {
  await sembrarBase();
  await crearDescartable('d1');
});

describe('el saldo del lote lo mantiene el log, no la aplicacion', () => {
  it('el ingreso carga el lote', async () => {
    await crearLote('l1', 'd1', '2026-12-31T00:00:00.000Z', 100);
    expect(await saldo('l1')).toBe(100);
  });

  it('consumo, devolucion y vencido mueven el saldo en el sentido correcto', async () => {
    await crearLote('l2', 'd1', '2026-12-31T00:00:00.000Z', 100);

    await movimiento('l2', 'consumo', 30);
    expect(await saldo('l2')).toBe(70);

    await movimiento('l2', 'devolucion', 5);
    expect(await saldo('l2')).toBe(75);

    await movimiento('l2', 'vencido', 25);
    expect(await saldo('l2')).toBe(50);
  });

  it('el ajuste viaja firmado', async () => {
    await crearLote('l3', 'd1', null, 100);

    await movimiento('l3', 'ajuste', -8);
    expect(await saldo('l3')).toBe(92);

    await movimiento('l3', 'ajuste', 3);
    expect(await saldo('l3')).toBe(95);
  });

  it('no se puede consumir mas de lo que hay en el lote', async () => {
    await crearLote('l4', 'd1', null, 10);

    await esperarAbort(() => movimiento('l4', 'consumo', 11), 'stock_insuficiente');
    expect(await saldo('l4')).toBe(10);
  });

  it('un ajuste negativo tampoco puede dejar el lote en rojo', async () => {
    await crearLote('l5', 'd1', null, 10);
    await esperarAbort(() => movimiento('l5', 'ajuste', -11), 'stock_insuficiente');
    expect(await saldo('l5')).toBe(10);
  });

  it('reenviar el mismo consumo no descuenta dos veces', async () => {
    await crearLote('l6', 'd1', null, 100);
    const id = nuevoId('ms');

    await movimiento('l6', 'consumo', 40, id);
    await movimiento('l6', 'consumo', 40, id);

    expect(await saldo('l6')).toBe(60);
  });
});

describe('movimiento_stock es append-only', () => {
  it('no admite UPDATE', async () => {
    await crearLote('l7', 'd1', null, 50);
    const id = await movimiento('l7', 'consumo', 10);

    await esperarAbort(
      () => env.DB.prepare('update movimiento_stock set cantidad = 1 where id = ?').bind(id).run(),
      'append_only',
    );
  });

  it('no admite DELETE', async () => {
    await crearLote('l8', 'd1', null, 50);
    const id = await movimiento('l8', 'consumo', 10);

    await esperarAbort(
      () => env.DB.prepare('delete from movimiento_stock where id = ?').bind(id).run(),
      'append_only',
    );
    expect(await saldo('l8')).toBe(40);
  });

  it('no se puede corregir el saldo a mano', async () => {
    await crearLote('l9', 'd1', null, 50);

    await esperarAbort(
      () =>
        env.DB.prepare('update lote_descartable set cantidad_actual = 999 where id = ?')
          .bind('l9')
          .run(),
      'saldo_no_modificable',
    );
    expect(await saldo('l9')).toBe(50);
  });
});

describe('orden FEFO', () => {
  /** Orden en que el consumo FEFO tiene que ir tomando los lotes. */
  async function ordenFefo(descartableId: string): Promise<string[]> {
    const { results } = await env.DB.prepare(
      `select id from lote_descartable
        where descartable_id = ? and cantidad_actual > 0
        order by vence_el is null, vence_el asc`,
    )
      .bind(descartableId)
      .all<{ id: string }>();
    return results.map((f) => f.id);
  }

  it('los lotes se ofrecen por vencimiento mas proximo primero', async () => {
    await crearDescartable('df1');
    await crearLote('f-lejano', 'df1', '2027-06-30T00:00:00.000Z', 100);
    await crearLote('f-proximo', 'df1', '2026-09-30T00:00:00.000Z', 100);
    await crearLote('f-medio', 'df1', '2026-12-31T00:00:00.000Z', 100);

    expect(await ordenFefo('df1')).toEqual(['f-proximo', 'f-medio', 'f-lejano']);
  });

  it('un lote agotado deja de ofrecerse y el siguiente pasa a ser el primero', async () => {
    await crearDescartable('df2');
    await crearLote('f1', 'df2', '2026-09-30T00:00:00.000Z', 20);
    await crearLote('f2', 'df2', '2026-12-31T00:00:00.000Z', 100);

    expect(await ordenFefo('df2')).toEqual(['f1', 'f2']);

    await movimiento('f1', 'consumo', 20);

    expect(await ordenFefo('df2')).toEqual(['f2']);
  });

  it('los lotes sin vencimiento van al final, no al principio', async () => {
    // NULL ordena primero en SQLite: sin el `vence_el is null` de la clausula
    // ORDER BY, un lote sin fecha se consumiria antes que uno por vencer.
    await crearDescartable('df3');
    await crearLote('f3', 'df3', null, 100);
    await crearLote('f4', 'df3', '2026-09-30T00:00:00.000Z', 100);

    expect(await ordenFefo('df3')).toEqual(['f4', 'f3']);
  });
});
