import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { ErrorDeNegocio } from '../api/respuestas';
import type { Db } from '../db';
import { schema } from '../db';
import type { TipoMovimientoStock } from '../dominio/estados';

export type Descartable = typeof schema.descartable.$inferSelect;
export type Lote = typeof schema.loteDescartable.$inferSelect;

/** Cuantos dias antes del vencimiento se avisa. */
export const DIAS_AVISO_VENCIMIENTO = 60;

export async function resolverDescartable(db: Db, ref: string): Promise<Descartable | undefined> {
  const porId = await db.query.descartable.findFirst({ where: eq(schema.descartable.id, ref) });
  if (porId) return porId;

  return db.query.descartable.findFirst({
    where: eq(schema.descartable.codigo, ref.trim().toUpperCase()),
  });
}

// ---------------------------------------------------------------------------
// Consumo FEFO
// ---------------------------------------------------------------------------

export interface Asignacion {
  loteId: string;
  numeroLote: string;
  venceEl: string | null;
  cantidad: number;
}

/**
 * Lotes disponibles en orden FEFO: primero el que vence antes.
 *
 * Dos detalles que no son opcionales:
 *
 * - Los lotes VENCIDOS quedan afuera. FEFO significa consumir primero lo que
 *   vence antes, no consumir lo vencido. Un descartable vencido no se usa en
 *   un paciente, se descarta.
 * - En SQLite los NULL ordenan primero, asi que un lote sin fecha de
 *   vencimiento se consumiria antes que uno que vence la semana que viene. El
 *   `vence_el is null` del ORDER BY los manda al final, que es lo correcto:
 *   lo que no vence puede esperar.
 */
export async function lotesDisponibles(db: Db, descartableId: string, ahora: string) {
  return db
    .select()
    .from(schema.loteDescartable)
    .where(
      and(
        eq(schema.loteDescartable.descartableId, descartableId),
        gt(schema.loteDescartable.cantidadActual, 0),
        or(
          isNull(schema.loteDescartable.venceEl),
          sql`${schema.loteDescartable.venceEl} >= ${ahora}`,
        ),
      ),
    )
    .orderBy(
      sql`${schema.loteDescartable.venceEl} is null`,
      asc(schema.loteDescartable.venceEl),
      asc(schema.loteDescartable.recibidoEn),
    );
}

export interface ResultadoConsumo {
  descartable: { id: string; codigo: string; nombre: string };
  cantidadConsumida: number;
  asignaciones: Asignacion[];
}

/**
 * Consume una cantidad repartiendola entre lotes por FEFO.
 *
 * Si no alcanza, no consume nada: descontar a medias dejaria el stock movido y
 * la cirugia igual de incompleta, y despues nadie sabe que falto.
 */
export async function consumirFefo(
  db: Db,
  usuarioId: string,
  descartableRef: string,
  cantidad: number,
  opciones: {
    cirugiaId?: string | null | undefined;
    ocurridoEn: string;
    motivo?: string | null | undefined;
    tipo?: Extract<TipoMovimientoStock, 'consumo' | 'vencido'>;
  },
): Promise<ResultadoConsumo> {
  const descartable = await resolverDescartable(db, descartableRef);
  if (!descartable) {
    throw new ErrorDeNegocio('descartable_inexistente', `No existe el descartable "${descartableRef}"`);
  }

  const lotes = await lotesDisponibles(db, descartable.id, opciones.ocurridoEn);
  const disponible = lotes.reduce((total, lote) => total + lote.cantidadActual, 0);

  if (disponible < cantidad) {
    // Se informa aparte lo que hay vencido: explica por que el numero no cierra
    // con lo que se ve en el estante.
    const vencido = await stockVencido(db, descartable.id, opciones.ocurridoEn);
    throw new ErrorDeNegocio(
      'stock_insuficiente',
      `No hay stock suficiente de ${descartable.nombre}`,
      { pedido: cantidad, disponible, vencidoSinDescartar: vencido },
    );
  }

  const asignaciones: Asignacion[] = [];
  let restante = cantidad;

  for (const lote of lotes) {
    if (restante === 0) break;
    const aTomar = Math.min(restante, lote.cantidadActual);

    await db.insert(schema.movimientoStock).values({
      id: crypto.randomUUID(),
      loteId: lote.id,
      tipo: opciones.tipo ?? 'consumo',
      cantidad: aTomar,
      cirugiaId: opciones.cirugiaId ?? null,
      usuarioId,
      ocurridoEn: opciones.ocurridoEn,
      motivo: opciones.motivo ?? null,
    });

    asignaciones.push({
      loteId: lote.id,
      numeroLote: lote.numeroLote,
      venceEl: lote.venceEl,
      cantidad: aTomar,
    });
    restante -= aTomar;
  }

  return {
    descartable: { id: descartable.id, codigo: descartable.codigo, nombre: descartable.nombre },
    cantidadConsumida: cantidad,
    asignaciones,
  };
}

async function stockVencido(db: Db, descartableId: string, ahora: string): Promise<number> {
  const [fila] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.loteDescartable.cantidadActual}), 0)` })
    .from(schema.loteDescartable)
    .where(
      and(
        eq(schema.loteDescartable.descartableId, descartableId),
        gt(schema.loteDescartable.cantidadActual, 0),
        sql`${schema.loteDescartable.venceEl} < ${ahora}`,
      ),
    );
  return fila?.total ?? 0;
}

// ---------------------------------------------------------------------------
// Recepcion, devolucion y ajustes
// ---------------------------------------------------------------------------

export async function recibirLote(
  db: Db,
  usuarioId: string,
  datos: {
    descartableRef: string;
    numeroLote: string;
    venceEl?: string | null | undefined;
    cantidad: number;
    recibidoEn: string;
    motivo?: string | null | undefined;
  },
): Promise<Lote> {
  const descartable = await resolverDescartable(db, datos.descartableRef);
  if (!descartable) {
    throw new ErrorDeNegocio('descartable_inexistente', `No existe el descartable "${datos.descartableRef}"`);
  }

  const id = crypto.randomUUID();
  // El lote nace en cero y se carga con un movimiento: el saldo no se escribe
  // nunca a mano, lo mantiene el trigger desde el log.
  await db.insert(schema.loteDescartable).values({
    id,
    descartableId: descartable.id,
    numeroLote: datos.numeroLote,
    venceEl: datos.venceEl ?? null,
    cantidadInicial: datos.cantidad,
    cantidadActual: 0,
    recibidoEn: datos.recibidoEn,
  });

  await db.insert(schema.movimientoStock).values({
    id: crypto.randomUUID(),
    loteId: id,
    tipo: 'ingreso',
    cantidad: datos.cantidad,
    usuarioId,
    ocurridoEn: datos.recibidoEn,
    motivo: datos.motivo ?? 'Recepcion',
  });

  const lote = await db.query.loteDescartable.findFirst({
    where: eq(schema.loteDescartable.id, id),
  });
  if (!lote) throw new ErrorDeNegocio('no_creado', 'El lote no quedo creado');
  return lote;
}

export async function movimientoDirecto(
  db: Db,
  usuarioId: string,
  datos: {
    loteId: string;
    tipo: TipoMovimientoStock;
    cantidad: number;
    cirugiaId?: string | null | undefined;
    ocurridoEn: string;
    motivo?: string | null | undefined;
  },
): Promise<Lote> {
  const lote = await db.query.loteDescartable.findFirst({
    where: eq(schema.loteDescartable.id, datos.loteId),
  });
  if (!lote) throw new ErrorDeNegocio('lote_inexistente', 'No existe ese lote');

  await db.insert(schema.movimientoStock).values({
    id: crypto.randomUUID(),
    loteId: datos.loteId,
    tipo: datos.tipo,
    cantidad: datos.cantidad,
    cirugiaId: datos.cirugiaId ?? null,
    usuarioId,
    ocurridoEn: datos.ocurridoEn,
    motivo: datos.motivo ?? null,
  });

  return (await db.query.loteDescartable.findFirst({
    where: eq(schema.loteDescartable.id, datos.loteId),
  })) as Lote;
}

/** Da de baja todo lo vencido que todavia tiene saldo. */
export async function descartarVencidos(
  db: Db,
  usuarioId: string,
  ahora: string,
): Promise<{ loteId: string; numeroLote: string; descartable: string; cantidad: number }[]> {
  const vencidos = await db
    .select({
      id: schema.loteDescartable.id,
      numeroLote: schema.loteDescartable.numeroLote,
      cantidad: schema.loteDescartable.cantidadActual,
      descartable: schema.descartable.nombre,
    })
    .from(schema.loteDescartable)
    .innerJoin(schema.descartable, eq(schema.descartable.id, schema.loteDescartable.descartableId))
    .where(
      and(
        gt(schema.loteDescartable.cantidadActual, 0),
        sql`${schema.loteDescartable.venceEl} < ${ahora}`,
      ),
    );

  const dados: { loteId: string; numeroLote: string; descartable: string; cantidad: number }[] = [];
  for (const lote of vencidos) {
    await db.insert(schema.movimientoStock).values({
      id: crypto.randomUUID(),
      loteId: lote.id,
      tipo: 'vencido',
      cantidad: lote.cantidad,
      usuarioId,
      ocurridoEn: ahora,
      motivo: 'Baja por vencimiento',
    });
    dados.push({
      loteId: lote.id,
      numeroLote: lote.numeroLote,
      descartable: lote.descartable,
      cantidad: lote.cantidad,
    });
  }
  return dados;
}

// ---------------------------------------------------------------------------
// Existencias y alertas
// ---------------------------------------------------------------------------

export interface ExistenciaDescartable {
  id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  puntoReposicion: number;
  /** Solo lo utilizable: no cuenta lo vencido. */
  disponible: number;
  vencidoSinDescartar: number;
  porVencer: number;
  necesitaReposicion: boolean;
}

export async function existencias(
  db: Db,
  ahora: string,
  diasAviso = DIAS_AVISO_VENCIMIENTO,
): Promise<ExistenciaDescartable[]> {
  const limiteAviso = new Date(
    new Date(ahora).getTime() + diasAviso * 24 * 60 * 60 * 1000,
  ).toISOString();

  const filas = await db
    .select({
      id: schema.descartable.id,
      codigo: schema.descartable.codigo,
      nombre: schema.descartable.nombre,
      unidad: schema.descartable.unidad,
      puntoReposicion: schema.descartable.puntoReposicion,
      disponible: sql<number>`coalesce(sum(case
        when ${schema.loteDescartable.venceEl} is null or ${schema.loteDescartable.venceEl} >= ${ahora}
        then ${schema.loteDescartable.cantidadActual} else 0 end), 0)`,
      vencidoSinDescartar: sql<number>`coalesce(sum(case
        when ${schema.loteDescartable.venceEl} < ${ahora}
        then ${schema.loteDescartable.cantidadActual} else 0 end), 0)`,
      porVencer: sql<number>`coalesce(sum(case
        when ${schema.loteDescartable.venceEl} >= ${ahora} and ${schema.loteDescartable.venceEl} < ${limiteAviso}
        then ${schema.loteDescartable.cantidadActual} else 0 end), 0)`,
    })
    .from(schema.descartable)
    .leftJoin(
      schema.loteDescartable,
      eq(schema.loteDescartable.descartableId, schema.descartable.id),
    )
    .where(eq(schema.descartable.activo, 1))
    .groupBy(schema.descartable.id)
    .orderBy(asc(schema.descartable.nombre));

  return filas.map((fila) => ({
    ...fila,
    necesitaReposicion: fila.disponible < fila.puntoReposicion,
  }));
}

export interface Alertas {
  generadoEn: string;
  diasAviso: number;
  reposicion: ExistenciaDescartable[];
  porVencer: {
    loteId: string;
    numeroLote: string;
    descartable: string;
    codigo: string;
    venceEl: string;
    cantidad: number;
    diasRestantes: number;
  }[];
  vencidos: {
    loteId: string;
    numeroLote: string;
    descartable: string;
    venceEl: string;
    cantidad: number;
  }[];
}

export async function alertas(
  db: Db,
  ahora: string,
  diasAviso = DIAS_AVISO_VENCIMIENTO,
): Promise<Alertas> {
  const limiteAviso = new Date(
    new Date(ahora).getTime() + diasAviso * 24 * 60 * 60 * 1000,
  ).toISOString();

  const todos = await existencias(db, ahora, diasAviso);

  const lotes = await db
    .select({
      loteId: schema.loteDescartable.id,
      numeroLote: schema.loteDescartable.numeroLote,
      venceEl: schema.loteDescartable.venceEl,
      cantidad: schema.loteDescartable.cantidadActual,
      descartable: schema.descartable.nombre,
      codigo: schema.descartable.codigo,
    })
    .from(schema.loteDescartable)
    .innerJoin(schema.descartable, eq(schema.descartable.id, schema.loteDescartable.descartableId))
    .where(gt(schema.loteDescartable.cantidadActual, 0))
    .orderBy(asc(schema.loteDescartable.venceEl));

  const unDia = 24 * 60 * 60 * 1000;

  return {
    generadoEn: ahora,
    diasAviso,
    reposicion: todos.filter((d) => d.necesitaReposicion),
    porVencer: lotes
      .filter((l) => l.venceEl !== null && l.venceEl >= ahora && l.venceEl < limiteAviso)
      .map((l) => ({
        loteId: l.loteId,
        numeroLote: l.numeroLote,
        descartable: l.descartable,
        codigo: l.codigo,
        venceEl: l.venceEl as string,
        cantidad: l.cantidad,
        diasRestantes: Math.floor(
          (new Date(l.venceEl as string).getTime() - new Date(ahora).getTime()) / unDia,
        ),
      })),
    vencidos: lotes
      .filter((l) => l.venceEl !== null && l.venceEl < ahora)
      .map((l) => ({
        loteId: l.loteId,
        numeroLote: l.numeroLote,
        descartable: l.descartable,
        venceEl: l.venceEl as string,
        cantidad: l.cantidad,
      })),
  };
}

export async function lotesDe(db: Db, descartableId: string) {
  return db
    .select()
    .from(schema.loteDescartable)
    .where(eq(schema.loteDescartable.descartableId, descartableId))
    .orderBy(asc(schema.loteDescartable.venceEl));
}

export async function movimientosDe(
  db: Db,
  filtros: { loteId?: string | undefined; cirugiaId?: string | undefined; limite: number },
) {
  const condiciones = [];
  if (filtros.loteId) condiciones.push(eq(schema.movimientoStock.loteId, filtros.loteId));
  if (filtros.cirugiaId) condiciones.push(eq(schema.movimientoStock.cirugiaId, filtros.cirugiaId));

  return db
    .select({
      id: schema.movimientoStock.id,
      loteId: schema.movimientoStock.loteId,
      numeroLote: schema.loteDescartable.numeroLote,
      descartable: schema.descartable.nombre,
      tipo: schema.movimientoStock.tipo,
      cantidad: schema.movimientoStock.cantidad,
      cirugiaId: schema.movimientoStock.cirugiaId,
      usuario: schema.usuario.nombre,
      ocurridoEn: schema.movimientoStock.ocurridoEn,
      motivo: schema.movimientoStock.motivo,
    })
    .from(schema.movimientoStock)
    .innerJoin(
      schema.loteDescartable,
      eq(schema.loteDescartable.id, schema.movimientoStock.loteId),
    )
    .innerJoin(schema.descartable, eq(schema.descartable.id, schema.loteDescartable.descartableId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.movimientoStock.usuarioId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(schema.movimientoStock.ocurridoEn))
    .limit(filtros.limite);
}

/**
 * Consume lo planificado de una cirugia, todo por FEFO.
 *
 * Es lo que cierra la trazabilidad del otro lado: despues de esto se puede
 * responder que numero de lote de sutura se uso en que paciente.
 */
export async function consumirPlanificadoDeCirugia(
  db: Db,
  usuarioId: string,
  cirugiaId: string,
  ocurridoEn: string,
): Promise<{ consumidos: ResultadoConsumo[]; faltantes: { descartable: string; detalle: unknown }[] }> {
  const cirugia = await db.query.cirugia.findFirst({ where: eq(schema.cirugia.id, cirugiaId) });
  if (!cirugia) throw new ErrorDeNegocio('cirugia_inexistente', 'No existe esa cirugia');

  const planificados = await db
    .select({
      descartableId: schema.cirugiaDescartable.descartableId,
      cantidad: schema.cirugiaDescartable.cantidadPlanificada,
      nombre: schema.descartable.nombre,
    })
    .from(schema.cirugiaDescartable)
    .innerJoin(
      schema.descartable,
      eq(schema.descartable.id, schema.cirugiaDescartable.descartableId),
    )
    .where(eq(schema.cirugiaDescartable.cirugiaId, cirugiaId));

  const consumidos: ResultadoConsumo[] = [];
  const faltantes: { descartable: string; detalle: unknown }[] = [];

  for (const item of planificados) {
    try {
      consumidos.push(
        await consumirFefo(db, usuarioId, item.descartableId, item.cantidad, {
          cirugiaId,
          ocurridoEn,
          motivo: `Consumo de la cirugia ${cirugia.pacienteRef}`,
        }),
      );
    } catch (error) {
      // Que falte una sutura no puede impedir descontar el resto: se registra
      // lo que si habia y se informa lo que falto.
      if (error instanceof ErrorDeNegocio) {
        faltantes.push({ descartable: item.nombre, detalle: error.detalle });
      } else {
        throw error;
      }
    }
  }

  return { consumidos, faltantes };
}
