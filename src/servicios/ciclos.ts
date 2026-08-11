import { and, asc, desc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';

import type { Db } from '../db';
import { schema } from '../db';
import type { EstadoCaja, MetodoEsterilizacion, ResultadoControl } from '../dominio/estados';
import { sePuedeLiberar, vencimientoDesde } from '../dominio/esterilizacion';
import { ErrorDeNegocio } from '../api/respuestas';
import { resolverCaja } from './cajas';
import { registrarMovimiento } from './eventos';

export type Ciclo = typeof schema.cicloEsterilizacion.$inferSelect;

export { ErrorDeNegocio as ErrorCiclo };

// ---------------------------------------------------------------------------
// Armado del ciclo
// ---------------------------------------------------------------------------

export interface DatosCiclo {
  numeroLote: string;
  equipoId: string;
  metodo: MetodoEsterilizacion;
  iniciadoEn: string;
  cajaRefs: readonly string[];
  observacion?: string | null | undefined;
}

/**
 * Arma un ciclo con las cajas escaneadas.
 *
 * Se valida todo antes de escribir nada: si una sola caja no esta en armado,
 * no se arma el ciclo. Cargar un autoclave a medias y descubrirlo despues
 * significa no saber que habia adentro, que es justo lo que este sistema
 * existe para evitar.
 */
export async function crearCiclo(db: Db, usuarioId: string, datos: DatosCiclo): Promise<Ciclo> {
  if (datos.cajaRefs.length === 0) {
    throw new ErrorDeNegocio('ciclo_vacio', 'Un ciclo tiene que llevar al menos una caja');
  }

  const resueltas: { id: string; codigo: string; estado: EstadoCaja }[] = [];
  const inexistentes: string[] = [];
  const noListas: { codigo: string; estado: string }[] = [];

  for (const ref of datos.cajaRefs) {
    const caja = await resolverCaja(db, ref);
    if (!caja) {
      inexistentes.push(ref);
      continue;
    }
    if (caja.estado !== 'en_armado') {
      noListas.push({ codigo: caja.codigo, estado: caja.estado });
      continue;
    }
    if (resueltas.some((c) => c.id === caja.id)) continue;
    resueltas.push({ id: caja.id, codigo: caja.codigo, estado: caja.estado as EstadoCaja });
  }

  if (inexistentes.length > 0 || noListas.length > 0) {
    throw new ErrorDeNegocio(
      'cajas_no_listas',
      'No se armo el ciclo porque hay cajas que no estan en armado',
      { inexistentes, noListas },
    );
  }

  const id = crypto.randomUUID();
  await db.insert(schema.cicloEsterilizacion).values({
    id,
    numeroLote: datos.numeroLote,
    equipoId: datos.equipoId,
    metodo: datos.metodo,
    iniciadoEn: datos.iniciadoEn,
    operadorId: usuarioId,
    observacion: datos.observacion ?? null,
  });

  for (const caja of resueltas) {
    await db.insert(schema.cicloCaja).values({ cicloId: id, cajaId: caja.id });
    await registrarMovimiento(db, {
      cajaId: caja.id,
      estadoDesde: 'en_armado',
      estadoHasta: 'en_esterilizacion',
      usuarioId,
      cicloId: id,
      ocurridoEn: datos.iniciadoEn,
      observacion: `Carga del lote ${datos.numeroLote}`,
    });
  }

  return obtenerCiclo(db, id) as Promise<Ciclo>;
}

export async function obtenerCiclo(db: Db, id: string): Promise<Ciclo | undefined> {
  const porId = await db.query.cicloEsterilizacion.findFirst({
    where: eq(schema.cicloEsterilizacion.id, id),
  });
  if (porId) return porId;

  return db.query.cicloEsterilizacion.findFirst({
    where: eq(schema.cicloEsterilizacion.numeroLote, id),
  });
}

export async function cajasDelCiclo(db: Db, cicloId: string) {
  return db
    .select({
      id: schema.caja.id,
      codigo: schema.caja.codigo,
      nombre: schema.caja.nombre,
      estado: schema.caja.estado,
      venceEl: schema.cicloCaja.venceEl,
    })
    .from(schema.cicloCaja)
    .innerJoin(schema.caja, eq(schema.caja.id, schema.cicloCaja.cajaId))
    .where(eq(schema.cicloCaja.cicloId, cicloId))
    .orderBy(asc(schema.caja.codigo));
}

export async function listarCiclos(
  db: Db,
  filtros: {
    controlBiologico?: ResultadoControl | undefined;
    equipoId?: string | undefined;
    limite: number;
  },
) {
  const condiciones = [];
  if (filtros.controlBiologico) {
    condiciones.push(eq(schema.cicloEsterilizacion.controlBiologico, filtros.controlBiologico));
  }
  if (filtros.equipoId) condiciones.push(eq(schema.cicloEsterilizacion.equipoId, filtros.equipoId));

  return db
    .select()
    .from(schema.cicloEsterilizacion)
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(schema.cicloEsterilizacion.iniciadoEn))
    .limit(filtros.limite);
}

// ---------------------------------------------------------------------------
// Fin del ciclo y cuarentena
// ---------------------------------------------------------------------------

export async function finalizarCiclo(
  db: Db,
  usuarioId: string,
  cicloId: string,
  datos: {
    finalizadoEn: string;
    temperaturaC?: number | null | undefined;
    tiempoMin?: number | null | undefined;
  },
): Promise<Ciclo> {
  const ciclo = await obtenerCiclo(db, cicloId);
  if (!ciclo) throw new ErrorDeNegocio('ciclo_inexistente', 'No existe ese ciclo');
  if (ciclo.finalizadoEn) {
    throw new ErrorDeNegocio('ciclo_ya_finalizado', 'El ciclo ya estaba finalizado');
  }

  await db
    .update(schema.cicloEsterilizacion)
    .set({
      finalizadoEn: datos.finalizadoEn,
      temperaturaC: datos.temperaturaC ?? null,
      tiempoMin: datos.tiempoMin ?? null,
    })
    .where(eq(schema.cicloEsterilizacion.id, ciclo.id));

  // Al salir del equipo las cajas quedan en cuarentena esperando el biologico.
  for (const caja of await cajasDelCiclo(db, ciclo.id)) {
    if (caja.estado !== 'en_esterilizacion') continue;
    await registrarMovimiento(db, {
      cajaId: caja.id,
      estadoDesde: 'en_esterilizacion',
      estadoHasta: 'en_cuarentena',
      usuarioId,
      cicloId: ciclo.id,
      ocurridoEn: datos.finalizadoEn,
      observacion: `Fin del lote ${ciclo.numeroLote}`,
    });
  }

  return obtenerCiclo(db, ciclo.id) as Promise<Ciclo>;
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

export interface ResultadoControles {
  ciclo: Ciclo;
  /** Presente solo si el biologico salio no conforme. */
  recall?: Impacto;
}

export async function cargarControles(
  db: Db,
  usuarioId: string,
  cicloId: string,
  datos: {
    controlFisico?: ResultadoControl | undefined;
    controlQuimico?: ResultadoControl | undefined;
    controlBiologico?: ResultadoControl | undefined;
    ocurridoEn: string;
  },
): Promise<ResultadoControles> {
  const ciclo = await obtenerCiclo(db, cicloId);
  if (!ciclo) throw new ErrorDeNegocio('ciclo_inexistente', 'No existe ese ciclo');

  const cambios: Partial<typeof schema.cicloEsterilizacion.$inferInsert> = {};
  if (datos.controlFisico) cambios.controlFisico = datos.controlFisico;
  if (datos.controlQuimico) cambios.controlQuimico = datos.controlQuimico;
  if (datos.controlBiologico) cambios.controlBiologico = datos.controlBiologico;

  if (Object.keys(cambios).length === 0) {
    throw new ErrorDeNegocio('sin_cambios', 'No se indico ningun control');
  }

  // Reescribir un control ya cargado lo aborta el trigger
  // ciclo_control_biologico_inmutable.
  await db
    .update(schema.cicloEsterilizacion)
    .set(cambios)
    .where(eq(schema.cicloEsterilizacion.id, ciclo.id));

  if (datos.controlBiologico === 'no_conforme') {
    return {
      ciclo: (await obtenerCiclo(db, ciclo.id)) as Ciclo,
      recall: await dispararRecall(db, usuarioId, ciclo.id, datos.ocurridoEn),
    };
  }

  return { ciclo: (await obtenerCiclo(db, ciclo.id)) as Ciclo };
}

// ---------------------------------------------------------------------------
// Liberacion
// ---------------------------------------------------------------------------

export async function liberarCiclo(
  db: Db,
  usuarioId: string,
  cicloId: string,
  datos: { liberadoEn: string; diasVigencia?: number | undefined },
): Promise<{ ciclo: Ciclo; liberadas: string[]; sinLiberar: { codigo: string; estado: string }[] }> {
  const ciclo = await obtenerCiclo(db, cicloId);
  if (!ciclo) throw new ErrorDeNegocio('ciclo_inexistente', 'No existe ese ciclo');
  if (ciclo.liberadoEn) throw new ErrorDeNegocio('ciclo_ya_liberado', 'El ciclo ya estaba liberado');

  if (
    !sePuedeLiberar({
      fisico: ciclo.controlFisico as ResultadoControl,
      quimico: ciclo.controlQuimico as ResultadoControl,
      biologico: ciclo.controlBiologico as ResultadoControl,
    })
  ) {
    throw new ErrorDeNegocio(
      'controles_incompletos',
      'No se puede liberar: los tres controles tienen que estar conformes',
      {
        controlFisico: ciclo.controlFisico,
        controlQuimico: ciclo.controlQuimico,
        controlBiologico: ciclo.controlBiologico,
      },
    );
  }

  const venceEl = vencimientoDesde(datos.liberadoEn, datos.diasVigencia);

  await db
    .update(schema.cicloEsterilizacion)
    .set({ liberadoPor: usuarioId, liberadoEn: datos.liberadoEn })
    .where(eq(schema.cicloEsterilizacion.id, ciclo.id));

  const liberadas: string[] = [];
  const sinLiberar: { codigo: string; estado: string }[] = [];

  for (const caja of await cajasDelCiclo(db, ciclo.id)) {
    if (caja.estado !== 'en_cuarentena') {
      sinLiberar.push({ codigo: caja.codigo, estado: caja.estado });
      continue;
    }

    await registrarMovimiento(db, {
      cajaId: caja.id,
      estadoDesde: 'en_cuarentena',
      estadoHasta: 'esteril_deposito',
      usuarioId,
      cicloId: ciclo.id,
      ocurridoEn: datos.liberadoEn,
      observacion: `Liberacion del lote ${ciclo.numeroLote}`,
    });

    // El vencimiento lo fija la liberacion, no el escaneo.
    await db
      .update(schema.cicloCaja)
      .set({ venceEl })
      .where(
        and(eq(schema.cicloCaja.cicloId, ciclo.id), eq(schema.cicloCaja.cajaId, caja.id)),
      );
    await db.update(schema.caja).set({ venceEl }).where(eq(schema.caja.id, caja.id));

    liberadas.push(caja.codigo);
  }

  return { ciclo: (await obtenerCiclo(db, ciclo.id)) as Ciclo, liberadas, sinLiberar };
}

// ---------------------------------------------------------------------------
// Recall e impacto
// ---------------------------------------------------------------------------

export interface CajaImpactada {
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
  accion: 'retirada' | 'ya_fuera_de_circulacion' | 'en_quirofano' | 'dada_de_baja';
}

export interface CirugiaImpactada {
  id: string;
  pacienteRef: string;
  programadaPara: string;
  estado: string;
  quirofano: string | null;
  cajas: string[];
}

export interface Impacto {
  cicloId: string;
  numeroLote: string;
  cajas: CajaImpactada[];
  cirugias: CirugiaImpactada[];
}

/**
 * Estados desde los que una caja de un lote no conforme se puede retirar.
 * `en_quirofano` no esta: la caja ya esta abierta sobre el campo quirurgico y
 * forzarla por sistema no la saca de ahi. Se reporta y sigue su curso normal.
 */
const RETIRABLES: readonly EstadoCaja[] = ['en_cuarentena', 'esteril_deposito', 'asignada'];

/**
 * Control biologico no conforme: todo el lote vuelve a lavado.
 *
 * Es la razon de ser del sistema. Cuando esto pasa hay que poder responder en
 * segundos que cajas estaban en ese lote y en que pacientes se usaron.
 */
export async function dispararRecall(
  db: Db,
  usuarioId: string,
  cicloId: string,
  ocurridoEn: string,
): Promise<Impacto> {
  const ciclo = await obtenerCiclo(db, cicloId);
  if (!ciclo) throw new ErrorDeNegocio('ciclo_inexistente', 'No existe ese ciclo');

  const cajas: CajaImpactada[] = [];

  for (const caja of await cajasDelCiclo(db, ciclo.id)) {
    const estado = caja.estado as EstadoCaja;

    if (estado === 'baja') {
      cajas.push({ ...caja, accion: 'dada_de_baja' });
      continue;
    }
    if (estado === 'en_quirofano') {
      cajas.push({ ...caja, accion: 'en_quirofano' });
      continue;
    }
    if (!RETIRABLES.includes(estado)) {
      // Ya esta en lavado, armado o sucia: salio del circuito esteril sola.
      cajas.push({ ...caja, accion: 'ya_fuera_de_circulacion' });
      continue;
    }

    await registrarMovimiento(db, {
      cajaId: caja.id,
      estadoDesde: estado,
      estadoHasta: 'en_lavado',
      usuarioId,
      cicloId: ciclo.id,
      ocurridoEn,
      observacion: `Retiro por control biologico no conforme del lote ${ciclo.numeroLote}`,
    });

    // La esterilidad de esa caja ya no vale nada.
    await db.update(schema.caja).set({ venceEl: null }).where(eq(schema.caja.id, caja.id));

    cajas.push({ ...caja, estado: 'en_lavado', accion: 'retirada' });
  }

  return {
    cicloId: ciclo.id,
    numeroLote: ciclo.numeroLote,
    cajas,
    cirugias: await cirugiasAfectadas(db, ciclo.id),
  };
}

/**
 * Cirugias que tocaron alguna caja del lote desde que entro al equipo.
 *
 * Se busca por dos lados porque son dos preguntas distintas: que cajas se
 * usaron ya (movimiento_caja con cirugia_id) y cuales estan comprometidas para
 * una cirugia que todavia no paso (cirugia_caja).
 */
export async function cirugiasAfectadas(db: Db, cicloId: string): Promise<CirugiaImpactada[]> {
  const ciclo = await obtenerCiclo(db, cicloId);
  if (!ciclo) return [];

  const idsDeCajas = (await cajasDelCiclo(db, ciclo.id)).map((c) => c.id);
  if (idsDeCajas.length === 0) return [];

  const porMovimiento = await db
    .selectDistinct({ cirugiaId: schema.movimientoCaja.cirugiaId, cajaId: schema.movimientoCaja.cajaId })
    .from(schema.movimientoCaja)
    .where(
      and(
        inArray(schema.movimientoCaja.cajaId, idsDeCajas),
        isNotNull(schema.movimientoCaja.cirugiaId),
        gte(schema.movimientoCaja.ocurridoEn, ciclo.iniciadoEn),
      ),
    );

  const porPlanificacion = await db
    .selectDistinct({ cirugiaId: schema.cirugiaCaja.cirugiaId, cajaId: schema.cirugiaCaja.cajaId })
    .from(schema.cirugiaCaja)
    .innerJoin(schema.cirugia, eq(schema.cirugia.id, schema.cirugiaCaja.cirugiaId))
    .where(
      and(
        inArray(schema.cirugiaCaja.cajaId, idsDeCajas),
        or(eq(schema.cirugia.estado, 'programada'), eq(schema.cirugia.estado, 'preparada')),
      ),
    );

  const cajasPorCirugia = new Map<string, Set<string>>();
  for (const fila of [...porMovimiento, ...porPlanificacion]) {
    if (!fila.cirugiaId) continue;
    const set = cajasPorCirugia.get(fila.cirugiaId) ?? new Set<string>();
    set.add(fila.cajaId);
    cajasPorCirugia.set(fila.cirugiaId, set);
  }

  if (cajasPorCirugia.size === 0) return [];

  const codigoDeCaja = new Map((await cajasDelCiclo(db, ciclo.id)).map((c) => [c.id, c.codigo]));

  const cirugias = await db
    .select()
    .from(schema.cirugia)
    .where(inArray(schema.cirugia.id, [...cajasPorCirugia.keys()]))
    .orderBy(desc(schema.cirugia.programadaPara));

  return cirugias.map((cirugia) => ({
    id: cirugia.id,
    pacienteRef: cirugia.pacienteRef,
    programadaPara: cirugia.programadaPara,
    estado: cirugia.estado,
    quirofano: cirugia.quirofano,
    cajas: [...(cajasPorCirugia.get(cirugia.id) ?? [])].map(
      (id) => codigoDeCaja.get(id) ?? id,
    ),
  }));
}

/** Vista de impacto sin escribir nada: sirve para mirar antes de decidir. */
export async function impactoDeCiclo(db: Db, cicloId: string): Promise<Impacto> {
  const ciclo = await obtenerCiclo(db, cicloId);
  if (!ciclo) throw new ErrorDeNegocio('ciclo_inexistente', 'No existe ese ciclo');

  const cajas: CajaImpactada[] = (await cajasDelCiclo(db, ciclo.id)).map((caja) => {
    const estado = caja.estado as EstadoCaja;
    const accion: CajaImpactada['accion'] =
      estado === 'baja'
        ? 'dada_de_baja'
        : estado === 'en_quirofano'
          ? 'en_quirofano'
          : RETIRABLES.includes(estado)
            ? 'retirada'
            : 'ya_fuera_de_circulacion';
    return { ...caja, accion };
  });

  return {
    cicloId: ciclo.id,
    numeroLote: ciclo.numeroLote,
    cajas,
    cirugias: await cirugiasAfectadas(db, ciclo.id),
  };
}
