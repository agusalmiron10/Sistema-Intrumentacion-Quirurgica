import { env } from 'cloudflare:test';
import { expect } from 'vitest';

import type { EstadoCaja } from '../src/dominio/estados';

export const USUARIO = 'u-test';
export const EQUIPO = 'eq-test';

let contador = 0;
export function nuevoId(prefijo = 'ev'): string {
  contador += 1;
  return `${prefijo}-${contador}-${crypto.randomUUID()}`;
}

/**
 * Alta minima: un usuario y un esterilizador.
 * Idempotente porque el pool ya no aisla el storage entre tests.
 */
export async function sembrarBase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into usuario (id, nombre, email, pin_hash, rol)
       values (?, 'Usuaria de prueba', 'test@hospital.local', 'x', 'instrumentadora')`,
    ).bind(USUARIO),
    env.DB.prepare(
      `insert or ignore into equipo_esterilizador (id, nombre, marca)
       values (?, 'Autoclave test', 'Getinge')`,
    ).bind(EQUIPO),
  ]);
}

export async function crearCaja(
  id: string,
  opciones: { codigo?: string; venceEl?: string | null; activa?: 0 | 1 } = {},
): Promise<void> {
  await env.DB.prepare(
    `insert into caja (id, codigo, nombre, vence_el, activa)
     values (?, ?, 'Caja de prueba', ?, ?)`,
  )
    .bind(id, opciones.codigo ?? id.toUpperCase(), opciones.venceEl ?? null, opciones.activa ?? 1)
    .run();
}

export interface OpcionesMovimiento {
  id?: string;
  cicloId?: string | null;
  cirugiaId?: string | null;
  ocurridoEn?: string;
  /** Por defecto true: es como sincroniza el cliente. */
  orIgnore?: boolean;
}

/** Inserta un movimiento tal como lo haria el endpoint de escaneo. */
export async function mover(
  cajaId: string,
  desde: EstadoCaja,
  hasta: EstadoCaja,
  opciones: OpcionesMovimiento = {},
): Promise<string> {
  const id = opciones.id ?? nuevoId('mov');
  const verbo = opciones.orIgnore === false ? 'insert into' : 'insert or ignore into';
  await env.DB.prepare(
    `${verbo} movimiento_caja
       (id, caja_id, estado_desde, estado_hasta, usuario_id, ciclo_id, cirugia_id, ocurrido_en)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      cajaId,
      desde,
      hasta,
      USUARIO,
      opciones.cicloId ?? null,
      opciones.cirugiaId ?? null,
      opciones.ocurridoEn ?? new Date().toISOString(),
    )
    .run();
  return id;
}

export async function estadoDe(cajaId: string): Promise<string | null> {
  const fila = await env.DB.prepare('select estado from caja where id = ?')
    .bind(cajaId)
    .first<{ estado: string }>();
  return fila?.estado ?? null;
}

export async function contarMovimientos(cajaId: string): Promise<number> {
  const fila = await env.DB.prepare('select count(*) as n from movimiento_caja where caja_id = ?')
    .bind(cajaId)
    .first<{ n: number }>();
  return fila?.n ?? 0;
}

export async function crearCiclo(
  id: string,
  cajaId: string,
  controlBiologico: 'pendiente' | 'conforme' | 'no_conforme',
  iniciadoEn = '2026-08-09T15:00:00.000Z',
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `insert into ciclo_esterilizacion
         (id, numero_lote, equipo_id, metodo, iniciado_en, control_biologico, operador_id)
       values (?, ?, ?, 'vapor_134', ?, ?, ?)`,
    ).bind(id, `lote-${id}`, EQUIPO, iniciadoEn, controlBiologico, USUARIO),
    env.DB.prepare('insert into ciclo_caja (ciclo_id, caja_id) values (?, ?)').bind(id, cajaId),
  ]);
}

/**
 * Espera que la operacion sea rechazada por un trigger, verificando el slug
 * del mensaje. Chequear solo "que falle" no alcanza: varios triggers pueden
 * abortar la misma operacion y queremos saber cual.
 */
export async function esperarAbort(
  operacion: () => Promise<unknown>,
  slug: string,
): Promise<void> {
  await expect(operacion()).rejects.toThrow(new RegExp(slug));
}
