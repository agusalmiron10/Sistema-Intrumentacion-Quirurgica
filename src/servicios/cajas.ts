import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { ActualizarCaja, CrearCaja, FiltrosCaja } from '../api/esquemas';
import type { Db } from '../db';
import { schema } from '../db';
import { normalizarCodigo, nuevoIdCaja } from '../dominio/identificadores';

export type Caja = typeof schema.caja.$inferSelect;

/**
 * Resuelve una caja por id o por codigo legible, indistintamente.
 *
 * Las dos vias tienen que funcionar en todos lados: el QR trae el id, y la
 * entrada manual (la etiqueta rayada, que es el caso comun) trae el codigo.
 */
export async function resolverCaja(db: Db, ref: string): Promise<Caja | undefined> {
  const porId = await db.query.caja.findFirst({ where: eq(schema.caja.id, ref) });
  if (porId) return porId;

  return db.query.caja.findFirst({ where: eq(schema.caja.codigo, normalizarCodigo(ref)) });
}

export async function listarCajas(db: Db, filtros: FiltrosCaja): Promise<Caja[]> {
  const condiciones = [];
  if (filtros.estado) condiciones.push(eq(schema.caja.estado, filtros.estado));
  if (filtros.servicio) condiciones.push(eq(schema.caja.servicio, filtros.servicio));
  if (filtros.activa) condiciones.push(eq(schema.caja.activa, Number(filtros.activa)));
  if (filtros.q) {
    const patron = `%${filtros.q.toUpperCase()}%`;
    condiciones.push(
      or(
        like(schema.caja.codigo, patron),
        like(sql`upper(${schema.caja.nombre})`, patron),
      ),
    );
  }

  return db
    .select()
    .from(schema.caja)
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(asc(schema.caja.codigo))
    .limit(filtros.limite);
}

export interface LineaContenido {
  instrumentoTipoId: string;
  nombre: string;
  codigo: string;
  cantidad: number;
  termosensible: boolean;
}

export async function obtenerContenido(db: Db, cajaId: string): Promise<LineaContenido[]> {
  const filas = await db
    .select({
      instrumentoTipoId: schema.cajaContenido.instrumentoTipoId,
      cantidad: schema.cajaContenido.cantidad,
      nombre: schema.instrumentoTipo.nombre,
      codigo: schema.instrumentoTipo.codigo,
      termosensible: schema.instrumentoTipo.termosensible,
    })
    .from(schema.cajaContenido)
    .innerJoin(
      schema.instrumentoTipo,
      eq(schema.instrumentoTipo.id, schema.cajaContenido.instrumentoTipoId),
    )
    .where(eq(schema.cajaContenido.cajaId, cajaId))
    .orderBy(asc(schema.instrumentoTipo.nombre));

  return filas.map((f) => ({ ...f, termosensible: f.termosensible === 1 }));
}

export async function obtenerHistorial(db: Db, cajaId: string, limite = 200) {
  return db
    .select()
    .from(schema.movimientoCaja)
    .where(eq(schema.movimientoCaja.cajaId, cajaId))
    .orderBy(desc(schema.movimientoCaja.ocurridoEn))
    .limit(limite);
}

/**
 * Alta de caja. La caja nace en `esteril_deposito` (el default de la columna);
 * a partir de ahi solo se mueve por movimiento_caja.
 *
 * El alta y su contenido van en un batch: D1 lo corre como transaccion, asi
 * que no puede quedar una caja a medio cargar.
 */
export async function crearCaja(db: Db, datos: CrearCaja): Promise<Caja> {
  const id = datos.id ?? nuevoIdCaja();

  const sentencias: BatchItem<'sqlite'>[] = [
    db.insert(schema.caja).values({
      id,
      codigo: datos.codigo,
      nombre: datos.nombre,
      servicio: datos.servicio ?? null,
      ubicacion: datos.ubicacion ?? null,
      venceEl: datos.venceEl ?? null,
    }),
  ];

  for (const linea of datos.contenido ?? []) {
    sentencias.push(
      db.insert(schema.cajaContenido).values({
        cajaId: id,
        instrumentoTipoId: linea.instrumentoTipoId,
        cantidad: linea.cantidad,
      }),
    );
  }

  await db.batch(sentencias as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  const creada = await db.query.caja.findFirst({ where: eq(schema.caja.id, id) });
  if (!creada) throw new Error('La caja no quedo creada');
  return creada;
}

/**
 * Edita los datos administrativos de la caja.
 *
 * `estado` no se acepta y no puede aceptarse: cambiarlo desde aca lo abortaria
 * el trigger `caja_estado_solo_por_movimiento`. Para mover una caja hay que
 * registrar un movimiento.
 */
export async function actualizarCaja(
  db: Db,
  id: string,
  datos: ActualizarCaja,
): Promise<Caja | undefined> {
  const cambios: Partial<typeof schema.caja.$inferInsert> = {};
  if (datos.codigo !== undefined) cambios.codigo = datos.codigo;
  if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
  if (datos.servicio !== undefined) cambios.servicio = datos.servicio;
  if (datos.ubicacion !== undefined) cambios.ubicacion = datos.ubicacion;
  if (datos.venceEl !== undefined) cambios.venceEl = datos.venceEl;
  if (datos.activa !== undefined) cambios.activa = datos.activa ? 1 : 0;

  await db.update(schema.caja).set(cambios).where(eq(schema.caja.id, id));
  return db.query.caja.findFirst({ where: eq(schema.caja.id, id) });
}

/** Reemplaza el contenido esperado completo. Borrado e inserciones en un batch. */
export async function reemplazarContenido(
  db: Db,
  cajaId: string,
  lineas: readonly { instrumentoTipoId: string; cantidad: number }[],
): Promise<LineaContenido[]> {
  const sentencias: BatchItem<'sqlite'>[] = [
    db.delete(schema.cajaContenido).where(eq(schema.cajaContenido.cajaId, cajaId)),
    ...lineas.map((linea) =>
      db.insert(schema.cajaContenido).values({
        cajaId,
        instrumentoTipoId: linea.instrumentoTipoId,
        cantidad: linea.cantidad,
      }),
    ),
  ];

  await db.batch(sentencias as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  return obtenerContenido(db, cajaId);
}
