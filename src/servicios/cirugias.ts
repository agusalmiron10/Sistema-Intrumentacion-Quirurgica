import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';
import { ErrorDeNegocio } from '../api/respuestas';
import { esTransicionCirugiaValida } from '../dominio/cirugias';
import type { EstadoCirugia } from '../dominio/estados';
import { resolverCaja } from './cajas';
import { registrarMovimiento } from './eventos';
import { resolverPlantilla } from './plantillas';

export type Cirugia = typeof schema.cirugia.$inferSelect;


export interface DatosCirugia {
  pacienteRef: string;
  procedimientoId: string;
  cirujanoId: string;
  instrumentadoraId?: string | null | undefined;
  quirofano?: string | null | undefined;
  programadaPara: string;
  notas?: string | null | undefined;
}

/**
 * Crea la cirugia resolviendo la plantilla y COPIANDO el resultado.
 *
 * La copia no es una optimizacion: la plantilla puede cambiar manana, y el
 * historico tiene que reflejar lo que realmente se preparo para este paciente,
 * no lo que hoy dice la preference card.
 */
export async function crearCirugia(
  db: Db,
  datos: DatosCirugia,
): Promise<{ cirugia: Cirugia; plantillaAplicada: string | null; sinPlantilla: boolean }> {
  const plantilla = await resolverPlantilla(db, datos.procedimientoId, datos.cirujanoId);
  const id = crypto.randomUUID();

  await db.insert(schema.cirugia).values({
    id,
    pacienteRef: datos.pacienteRef,
    procedimientoId: datos.procedimientoId,
    cirujanoId: datos.cirujanoId,
    instrumentadoraId: datos.instrumentadoraId ?? null,
    plantillaId: plantilla?.id ?? null,
    quirofano: datos.quirofano ?? null,
    programadaPara: datos.programadaPara,
    notas: datos.notas ?? null,
  });

  if (plantilla) {
    const cajas = await db
      .select()
      .from(schema.plantillaCaja)
      .where(eq(schema.plantillaCaja.plantillaId, plantilla.id));
    for (const caja of cajas) {
      await db.insert(schema.cirugiaCaja).values({ cirugiaId: id, cajaId: caja.cajaId });
    }

    const descartables = await db
      .select()
      .from(schema.plantillaDescartable)
      .where(eq(schema.plantillaDescartable.plantillaId, plantilla.id));
    for (const descartable of descartables) {
      await db.insert(schema.cirugiaDescartable).values({
        cirugiaId: id,
        descartableId: descartable.descartableId,
        cantidadPlanificada: descartable.cantidad,
      });
    }
  }

  const cirugia = await db.query.cirugia.findFirst({ where: eq(schema.cirugia.id, id) });
  if (!cirugia) throw new ErrorDeNegocio('no_creada', 'La cirugia no quedo creada');

  return {
    cirugia,
    plantillaAplicada: plantilla?.id ?? null,
    sinPlantilla: plantilla === undefined,
  };
}

export async function obtenerCirugia(db: Db, id: string) {
  const cirugia = await db.query.cirugia.findFirst({ where: eq(schema.cirugia.id, id) });
  if (!cirugia) return undefined;

  const cajas = await db
    .select({
      cajaId: schema.cirugiaCaja.cajaId,
      codigo: schema.caja.codigo,
      nombre: schema.caja.nombre,
      estado: schema.caja.estado,
      venceEl: schema.caja.venceEl,
      usada: schema.cirugiaCaja.usada,
    })
    .from(schema.cirugiaCaja)
    .innerJoin(schema.caja, eq(schema.caja.id, schema.cirugiaCaja.cajaId))
    .where(eq(schema.cirugiaCaja.cirugiaId, id))
    .orderBy(asc(schema.caja.codigo));

  const descartables = await db
    .select({
      descartableId: schema.cirugiaDescartable.descartableId,
      codigo: schema.descartable.codigo,
      nombre: schema.descartable.nombre,
      unidad: schema.descartable.unidad,
      cantidadPlanificada: schema.cirugiaDescartable.cantidadPlanificada,
    })
    .from(schema.cirugiaDescartable)
    .innerJoin(
      schema.descartable,
      eq(schema.descartable.id, schema.cirugiaDescartable.descartableId),
    )
    .where(eq(schema.cirugiaDescartable.cirugiaId, id))
    .orderBy(asc(schema.descartable.nombre));

  return {
    ...cirugia,
    cajas: cajas.map((c) => ({ ...c, usada: c.usada === 1 })),
    descartables,
  };
}

export async function listarCirugias(
  db: Db,
  filtros: {
    desde?: string | undefined;
    hasta?: string | undefined;
    estado?: EstadoCirugia | undefined;
    limite: number;
  },
) {
  const condiciones = [];
  if (filtros.desde) condiciones.push(gte(schema.cirugia.programadaPara, filtros.desde));
  if (filtros.hasta) condiciones.push(lte(schema.cirugia.programadaPara, filtros.hasta));
  if (filtros.estado) condiciones.push(eq(schema.cirugia.estado, filtros.estado));

  return db
    .select({
      id: schema.cirugia.id,
      pacienteRef: schema.cirugia.pacienteRef,
      procedimiento: schema.procedimiento.nombre,
      cirujano: schema.cirujano.nombre,
      quirofano: schema.cirugia.quirofano,
      programadaPara: schema.cirugia.programadaPara,
      estado: schema.cirugia.estado,
    })
    .from(schema.cirugia)
    .innerJoin(schema.procedimiento, eq(schema.procedimiento.id, schema.cirugia.procedimientoId))
    .innerJoin(schema.cirujano, eq(schema.cirujano.id, schema.cirugia.cirujanoId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(schema.cirugia.programadaPara))
    .limit(filtros.limite);
}

/**
 * Cambia el estado de la cirugia.
 *
 * Pasar a `preparada` asigna las cajas: cada una que este en el deposito
 * esteril pasa a `asignada` con un movimiento real. Las que no puedan (porque
 * estan sucias, vencidas o en otro lado) se devuelven con el motivo, sin
 * frenar al resto: la instrumentadora tiene que ver que le falta, no un error
 * generico.
 */
export async function cambiarEstado(
  db: Db,
  usuarioId: string,
  cirugiaId: string,
  nuevo: EstadoCirugia,
  ocurridoEn: string,
): Promise<{
  cirugia: Cirugia;
  cajasAsignadas: string[];
  cajasConProblema: { codigo: string; estado: string; motivo: string }[];
}> {
  const cirugia = await db.query.cirugia.findFirst({ where: eq(schema.cirugia.id, cirugiaId) });
  if (!cirugia) throw new ErrorDeNegocio('cirugia_inexistente', 'No existe esa cirugia');

  const actual = cirugia.estado as EstadoCirugia;
  if (!esTransicionCirugiaValida(actual, nuevo)) {
    throw new ErrorDeNegocio(
      'transicion_cirugia_invalida',
      `Una cirugia en "${actual}" no puede pasar a "${nuevo}"`,
      { desde: actual, hasta: nuevo },
    );
  }

  const cajasAsignadas: string[] = [];
  const cajasConProblema: { codigo: string; estado: string; motivo: string }[] = [];

  if (nuevo === 'preparada') {
    const detalle = await obtenerCirugia(db, cirugiaId);
    for (const caja of detalle?.cajas ?? []) {
      if (caja.estado === 'asignada') {
        cajasAsignadas.push(caja.codigo);
        continue;
      }
      if (caja.estado !== 'esteril_deposito') {
        cajasConProblema.push({
          codigo: caja.codigo,
          estado: caja.estado,
          motivo: 'No esta disponible en el deposito esteril',
        });
        continue;
      }
      if (caja.venceEl && caja.venceEl < ocurridoEn) {
        cajasConProblema.push({
          codigo: caja.codigo,
          estado: caja.estado,
          motivo: 'La esterilidad esta vencida',
        });
        continue;
      }

      try {
        await registrarMovimiento(db, {
          cajaId: caja.cajaId,
          estadoDesde: 'esteril_deposito',
          estadoHasta: 'asignada',
          usuarioId,
          cirugiaId,
          ocurridoEn,
          observacion: `Preparacion de la cirugia ${cirugia.pacienteRef}`,
        });
        cajasAsignadas.push(caja.codigo);
      } catch {
        cajasConProblema.push({
          codigo: caja.codigo,
          estado: caja.estado,
          motivo: 'El servidor rechazo la asignacion',
        });
      }
    }
  }

  await db.update(schema.cirugia).set({ estado: nuevo }).where(eq(schema.cirugia.id, cirugiaId));

  const actualizada = await db.query.cirugia.findFirst({ where: eq(schema.cirugia.id, cirugiaId) });
  return { cirugia: actualizada as Cirugia, cajasAsignadas, cajasConProblema };
}

/** Agrega una caja que no estaba en la plantilla. */
export async function agregarCaja(db: Db, cirugiaId: string, ref: string): Promise<void> {
  const cirugia = await db.query.cirugia.findFirst({ where: eq(schema.cirugia.id, cirugiaId) });
  if (!cirugia) throw new ErrorDeNegocio('cirugia_inexistente', 'No existe esa cirugia');

  const caja = await resolverCaja(db, ref);
  if (!caja) throw new ErrorDeNegocio('caja_inexistente', `No hay ninguna caja "${ref}"`);

  await db
    .insert(schema.cirugiaCaja)
    .values({ cirugiaId, cajaId: caja.id })
    .onConflictDoNothing();
}

export async function quitarCaja(db: Db, cirugiaId: string, ref: string): Promise<void> {
  const caja = await resolverCaja(db, ref);
  if (!caja) throw new ErrorDeNegocio('caja_inexistente', `No hay ninguna caja "${ref}"`);

  await db
    .delete(schema.cirugiaCaja)
    .where(
      and(eq(schema.cirugiaCaja.cirugiaId, cirugiaId), eq(schema.cirugiaCaja.cajaId, caja.id)),
    );
}

/** Marca que la caja se abrio y se uso en el paciente. */
export async function marcarUsada(db: Db, cirugiaId: string, ref: string, usada: boolean) {
  const caja = await resolverCaja(db, ref);
  if (!caja) throw new ErrorDeNegocio('caja_inexistente', `No hay ninguna caja "${ref}"`);

  await db
    .update(schema.cirugiaCaja)
    .set({ usada: usada ? 1 : 0 })
    .where(
      and(eq(schema.cirugiaCaja.cirugiaId, cirugiaId), eq(schema.cirugiaCaja.cajaId, caja.id)),
    );
}

/**
 * Trazabilidad completa de una cirugia: que cajas se usaron, de que ciclo
 * salieron y con que lote de descartables. Es la consulta que hay que poder
 * contestar cuando algo sale mal.
 */
export async function trazabilidad(db: Db, cirugiaId: string) {
  const cirugia = await obtenerCirugia(db, cirugiaId);
  if (!cirugia) throw new ErrorDeNegocio('cirugia_inexistente', 'No existe esa cirugia');

  const movimientos = await db
    .select({
      cajaId: schema.movimientoCaja.cajaId,
      codigo: schema.caja.codigo,
      estadoDesde: schema.movimientoCaja.estadoDesde,
      estadoHasta: schema.movimientoCaja.estadoHasta,
      ocurridoEn: schema.movimientoCaja.ocurridoEn,
      usuario: schema.usuario.nombre,
      cicloId: schema.movimientoCaja.cicloId,
    })
    .from(schema.movimientoCaja)
    .innerJoin(schema.caja, eq(schema.caja.id, schema.movimientoCaja.cajaId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.movimientoCaja.usuarioId))
    .where(eq(schema.movimientoCaja.cirugiaId, cirugiaId))
    .orderBy(asc(schema.movimientoCaja.ocurridoEn));

  // El ciclo de esterilizacion del que salio cada caja usada.
  const ciclos = await db
    .select({
      cajaId: schema.cicloCaja.cajaId,
      codigo: schema.caja.codigo,
      cicloId: schema.cicloEsterilizacion.id,
      numeroLote: schema.cicloEsterilizacion.numeroLote,
      metodo: schema.cicloEsterilizacion.metodo,
      controlBiologico: schema.cicloEsterilizacion.controlBiologico,
      liberadoEn: schema.cicloEsterilizacion.liberadoEn,
    })
    .from(schema.cirugiaCaja)
    .innerJoin(schema.cicloCaja, eq(schema.cicloCaja.cajaId, schema.cirugiaCaja.cajaId))
    .innerJoin(
      schema.cicloEsterilizacion,
      eq(schema.cicloEsterilizacion.id, schema.cicloCaja.cicloId),
    )
    .innerJoin(schema.caja, eq(schema.caja.id, schema.cirugiaCaja.cajaId))
    .where(eq(schema.cirugiaCaja.cirugiaId, cirugiaId))
    .orderBy(desc(schema.cicloEsterilizacion.iniciadoEn));

  const consumos = await db
    .select({
      loteId: schema.movimientoStock.loteId,
      numeroLote: schema.loteDescartable.numeroLote,
      descartable: schema.descartable.nombre,
      codigo: schema.descartable.codigo,
      cantidad: schema.movimientoStock.cantidad,
      tipo: schema.movimientoStock.tipo,
      ocurridoEn: schema.movimientoStock.ocurridoEn,
      venceEl: schema.loteDescartable.venceEl,
    })
    .from(schema.movimientoStock)
    .innerJoin(
      schema.loteDescartable,
      eq(schema.loteDescartable.id, schema.movimientoStock.loteId),
    )
    .innerJoin(schema.descartable, eq(schema.descartable.id, schema.loteDescartable.descartableId))
    .where(eq(schema.movimientoStock.cirugiaId, cirugiaId))
    .orderBy(asc(schema.movimientoStock.ocurridoEn));

  return { cirugia, movimientos, ciclos, consumos };
}
