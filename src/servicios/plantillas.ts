import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';
import { ErrorDeNegocio } from '../api/respuestas';

export type Plantilla = typeof schema.plantilla.$inferSelect;


export interface PlantillaCompleta extends Plantilla {
  procedimiento: string;
  cirujano: string | null;
  cajas: { cajaId: string; codigo: string; nombre: string; obligatoria: boolean }[];
  descartables: { descartableId: string; codigo: string; nombre: string; cantidad: number }[];
}

/**
 * Resolucion de plantilla.
 *
 * Primero la del cirujano, y si no tiene, la generica del procedimiento. Es
 * exactamente el orden de una preference card: el armado estandar del servicio
 * salvo que este cirujano pida otra cosa.
 */
export async function resolverPlantilla(
  db: Db,
  procedimientoId: string,
  cirujanoId: string,
): Promise<Plantilla | undefined> {
  const delCirujano = await db.query.plantilla.findFirst({
    where: and(
      eq(schema.plantilla.procedimientoId, procedimientoId),
      eq(schema.plantilla.cirujanoId, cirujanoId),
      eq(schema.plantilla.vigente, 1),
    ),
  });
  if (delCirujano) return delCirujano;

  return db.query.plantilla.findFirst({
    where: and(
      eq(schema.plantilla.procedimientoId, procedimientoId),
      isNull(schema.plantilla.cirujanoId),
      eq(schema.plantilla.vigente, 1),
    ),
  });
}

export async function obtenerPlantilla(
  db: Db,
  id: string,
): Promise<PlantillaCompleta | undefined> {
  const plantilla = await db.query.plantilla.findFirst({ where: eq(schema.plantilla.id, id) });
  if (!plantilla) return undefined;

  const [procedimiento] = await db
    .select({ nombre: schema.procedimiento.nombre })
    .from(schema.procedimiento)
    .where(eq(schema.procedimiento.id, plantilla.procedimientoId));

  const cirujano = plantilla.cirujanoId
    ? (
        await db
          .select({ nombre: schema.cirujano.nombre })
          .from(schema.cirujano)
          .where(eq(schema.cirujano.id, plantilla.cirujanoId))
      )[0]
    : undefined;

  const cajas = await db
    .select({
      cajaId: schema.plantillaCaja.cajaId,
      codigo: schema.caja.codigo,
      nombre: schema.caja.nombre,
      obligatoria: schema.plantillaCaja.obligatoria,
    })
    .from(schema.plantillaCaja)
    .innerJoin(schema.caja, eq(schema.caja.id, schema.plantillaCaja.cajaId))
    .where(eq(schema.plantillaCaja.plantillaId, id))
    .orderBy(asc(schema.caja.codigo));

  const descartables = await db
    .select({
      descartableId: schema.plantillaDescartable.descartableId,
      codigo: schema.descartable.codigo,
      nombre: schema.descartable.nombre,
      cantidad: schema.plantillaDescartable.cantidad,
    })
    .from(schema.plantillaDescartable)
    .innerJoin(
      schema.descartable,
      eq(schema.descartable.id, schema.plantillaDescartable.descartableId),
    )
    .where(eq(schema.plantillaDescartable.plantillaId, id))
    .orderBy(asc(schema.descartable.nombre));

  return {
    ...plantilla,
    procedimiento: procedimiento?.nombre ?? '',
    cirujano: cirujano?.nombre ?? null,
    cajas: cajas.map((c) => ({ ...c, obligatoria: c.obligatoria === 1 })),
    descartables,
  };
}

export async function listarPlantillas(
  db: Db,
  filtros: { procedimientoId?: string | undefined; cirujanoId?: string | undefined; soloVigentes: boolean },
) {
  const condiciones = [];
  if (filtros.procedimientoId) {
    condiciones.push(eq(schema.plantilla.procedimientoId, filtros.procedimientoId));
  }
  if (filtros.cirujanoId) condiciones.push(eq(schema.plantilla.cirujanoId, filtros.cirujanoId));
  if (filtros.soloVigentes) condiciones.push(eq(schema.plantilla.vigente, 1));

  return db
    .select({
      id: schema.plantilla.id,
      procedimientoId: schema.plantilla.procedimientoId,
      procedimiento: schema.procedimiento.nombre,
      cirujanoId: schema.plantilla.cirujanoId,
      cirujano: schema.cirujano.nombre,
      version: schema.plantilla.version,
      vigente: schema.plantilla.vigente,
      notas: schema.plantilla.notas,
      creadoEn: schema.plantilla.creadoEn,
    })
    .from(schema.plantilla)
    .innerJoin(schema.procedimiento, eq(schema.procedimiento.id, schema.plantilla.procedimientoId))
    .leftJoin(schema.cirujano, eq(schema.cirujano.id, schema.plantilla.cirujanoId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(asc(schema.procedimiento.nombre), desc(schema.plantilla.version));
}

export interface DatosPlantilla {
  procedimientoId: string;
  cirujanoId?: string | null | undefined;
  notas?: string | null | undefined;
  cajas: readonly { cajaId: string; obligatoria?: boolean | undefined }[];
  descartables: readonly { descartableId: string; cantidad: number }[];
}

/**
 * Crea una version nueva de la plantilla.
 *
 * Las plantillas no se editan: se versionan. La anterior queda como historico
 * porque las cirugias viejas la referencian, y hay que poder responder con que
 * armado se preparo cada una.
 */
export async function crearVersion(db: Db, datos: DatosPlantilla): Promise<PlantillaCompleta> {
  const anterior = datos.cirujanoId
    ? await db.query.plantilla.findFirst({
        where: and(
          eq(schema.plantilla.procedimientoId, datos.procedimientoId),
          eq(schema.plantilla.cirujanoId, datos.cirujanoId),
          eq(schema.plantilla.vigente, 1),
        ),
      })
    : await db.query.plantilla.findFirst({
        where: and(
          eq(schema.plantilla.procedimientoId, datos.procedimientoId),
          isNull(schema.plantilla.cirujanoId),
          eq(schema.plantilla.vigente, 1),
        ),
      });

  if (anterior) {
    // Se baja primero: el indice unico parcial no admite dos vigentes para el
    // mismo par (procedimiento, cirujano).
    await db
      .update(schema.plantilla)
      .set({ vigente: 0 })
      .where(eq(schema.plantilla.id, anterior.id));
  }

  const id = crypto.randomUUID();
  await db.insert(schema.plantilla).values({
    id,
    procedimientoId: datos.procedimientoId,
    cirujanoId: datos.cirujanoId ?? null,
    version: (anterior?.version ?? 0) + 1,
    notas: datos.notas ?? null,
    vigente: 1,
  });

  for (const caja of datos.cajas) {
    await db.insert(schema.plantillaCaja).values({
      plantillaId: id,
      cajaId: caja.cajaId,
      obligatoria: caja.obligatoria === false ? 0 : 1,
    });
  }
  for (const descartable of datos.descartables) {
    await db.insert(schema.plantillaDescartable).values({
      plantillaId: id,
      descartableId: descartable.descartableId,
      cantidad: descartable.cantidad,
    });
  }

  const creada = await obtenerPlantilla(db, id);
  if (!creada) throw new ErrorDeNegocio('no_creada', 'La plantilla no quedo creada');
  return creada;
}

export async function darDeBaja(db: Db, id: string): Promise<void> {
  const plantilla = await db.query.plantilla.findFirst({ where: eq(schema.plantilla.id, id) });
  if (!plantilla) throw new ErrorDeNegocio('plantilla_inexistente', 'No existe esa plantilla');

  await db.update(schema.plantilla).set({ vigente: 0 }).where(eq(schema.plantilla.id, id));
}

/** Cuantas cirugias congelaron esta plantilla. Sirve para saber si se usa. */
export async function usosDePlantilla(db: Db, id: string): Promise<number> {
  const [fila] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.cirugia)
    .where(eq(schema.cirugia.plantillaId, id));
  return fila?.n ?? 0;
}
