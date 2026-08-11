import { eq } from 'drizzle-orm';

import { interpretarErrorD1 } from '../api/errores';
import type { Db } from '../db';
import { schema } from '../db';
import type { EstadoCaja } from '../dominio/estados';
import { resolverCaja } from './cajas';

/**
 * Sincronizacion de eventos de escaneo.
 *
 * Es el unico camino por el que una caja cambia de estado. Todo lo demas
 * (pantallas, cola offline, lector USB) termina aca.
 */

export interface EventoEntrante {
  /** Generado por el cliente con crypto.randomUUID() antes de tocar la red. */
  id: string;
  /** Id o codigo legible: el QR trae el id, la entrada manual trae el codigo. */
  cajaRef: string;
  /** Quien escaneo, segun el dispositivo. Tiene que coincidir con la sesion. */
  usuarioId: string;
  estadoDesde: EstadoCaja;
  estadoHasta: EstadoCaja;
  ocurridoEn: string;
  cirugiaId?: string | null | undefined;
  cicloId?: string | null | undefined;
  observacion?: string | null | undefined;
}

export type ResultadoEvento = {
  id: string;
  cajaRef: string;
  cajaId?: string | undefined;
  /** Estado real de la caja despues de procesar. Sirve para explicar el conflicto. */
  estadoActual?: string | undefined;
  estado: 'aplicado' | 'duplicado' | 'conflicto';
  codigo?: string | undefined;
  mensaje?: string | undefined;
};

/**
 * Margen de tolerancia para relojes desfasados.
 *
 * Un evento con fecha futura es peligroso y no solo raro: el orden de
 * aplicacion sale de `ocurrido_en`, y el control de vencimiento se compara
 * contra ese mismo campo. Una tablet con la fecha mal puesta podria colar
 * una caja vencida como vigente. Se rechaza y se le avisa a la usuaria.
 */
const MARGEN_FUTURO_MS = 60 * 60 * 1000;

/**
 * Registra un movimiento generado por el propio servidor (armado de un ciclo,
 * liberacion, recall). Sigue siendo un INSERT en movimiento_caja: no hay otra
 * forma de mover una caja, ni siquiera desde adentro.
 */
export async function registrarMovimiento(
  db: Db,
  datos: {
    cajaId: string;
    estadoDesde: EstadoCaja;
    estadoHasta: EstadoCaja;
    usuarioId: string;
    cicloId?: string | null | undefined;
    cirugiaId?: string | null | undefined;
    ocurridoEn: string;
    observacion?: string | null | undefined;
  },
): Promise<void> {
  await db
    .insert(schema.movimientoCaja)
    .values({
      id: crypto.randomUUID(),
      cajaId: datos.cajaId,
      estadoDesde: datos.estadoDesde,
      estadoHasta: datos.estadoHasta,
      usuarioId: datos.usuarioId,
      cicloId: datos.cicloId ?? null,
      cirugiaId: datos.cirugiaId ?? null,
      ocurridoEn: datos.ocurridoEn,
      observacion: datos.observacion ?? null,
    })
    .run();
}

export async function sincronizarEventos(
  db: Db,
  usuarioDeLaSesion: string,
  entrantes: readonly EventoEntrante[],
  ahora = new Date(),
): Promise<ResultadoEvento[]> {
  // Se aplican en orden cronologico real, no en el orden en que llegaron.
  // Dos escaneos encolados juntos (en_lavado, despues en_armado) fallarian si
  // se aplicaran al reves. El id desempata para que el resultado sea
  // determinista ante fechas identicas.
  const ordenados = [...entrantes].sort((a, b) =>
    a.ocurridoEn === b.ocurridoEn
      ? a.id.localeCompare(b.id)
      : a.ocurridoEn.localeCompare(b.ocurridoEn),
  );

  const limiteFuturo = new Date(ahora.getTime() + MARGEN_FUTURO_MS).toISOString();
  const resultados: ResultadoEvento[] = [];

  for (const evento of ordenados) {
    // Nadie sincroniza escaneos a nombre de otro. Si la tablet cambio de mano
    // con la cola sin vaciar, esos eventos esperan a que vuelva su duenio.
    if (evento.usuarioId !== usuarioDeLaSesion) {
      resultados.push({
        id: evento.id,
        cajaRef: evento.cajaRef,
        estado: 'conflicto',
        codigo: 'usuario_distinto',
        mensaje: 'El escaneo lo hizo otro usuario. Tiene que sincronizarlo esa persona.',
      });
      continue;
    }

    if (evento.ocurridoEn > limiteFuturo) {
      resultados.push({
        id: evento.id,
        cajaRef: evento.cajaRef,
        estado: 'conflicto',
        codigo: 'reloj_desfasado',
        mensaje: 'El escaneo tiene fecha futura. Revisar la hora del dispositivo.',
      });
      continue;
    }

    const caja = await resolverCaja(db, evento.cajaRef);
    if (!caja) {
      resultados.push({
        id: evento.id,
        cajaRef: evento.cajaRef,
        estado: 'conflicto',
        codigo: 'caja_inexistente',
        mensaje: `No hay ninguna caja con id o codigo "${evento.cajaRef}"`,
      });
      continue;
    }

    try {
      // onConflictDoNothing + returning distingue el alta real del reenvio:
      // si el evento ya estaba, no vuelve ninguna fila. Los triggers de
      // validacion no se disparan en ese caso porque llevan la guarda de
      // idempotencia (ver migrations/0501_triggers.sql).
      const insertadas = await db
        .insert(schema.movimientoCaja)
        .values({
          id: evento.id,
          cajaId: caja.id,
          estadoDesde: evento.estadoDesde,
          estadoHasta: evento.estadoHasta,
          usuarioId: evento.usuarioId,
          cirugiaId: evento.cirugiaId ?? null,
          cicloId: evento.cicloId ?? null,
          ocurridoEn: evento.ocurridoEn,
          observacion: evento.observacion ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.movimientoCaja.id });

      const actual = await db.query.caja.findFirst({ where: eq(schema.caja.id, caja.id) });
      resultados.push({
        id: evento.id,
        cajaRef: evento.cajaRef,
        cajaId: caja.id,
        estadoActual: actual?.estado,
        estado: insertadas.length > 0 ? 'aplicado' : 'duplicado',
      });
    } catch (error) {
      const interpretado = interpretarErrorD1(error);
      if (!interpretado) throw error;

      // El conflicto se devuelve, nunca se descarta: la usuaria escaneo algo y
      // tiene que enterarse de por que no se registro.
      resultados.push({
        id: evento.id,
        cajaRef: evento.cajaRef,
        cajaId: caja.id,
        estadoActual: caja.estado,
        estado: 'conflicto',
        codigo: interpretado.codigo,
        mensaje: interpretado.mensaje,
      });
    }
  }

  return resultados;
}
