import type { Workbook, Worksheet } from 'exceljs';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { ErrorDeNegocio } from '../api/respuestas';
import type { Db } from '../db';
import { schema } from '../db';
import { resolverCaja } from './cajas';
import { trazabilidad } from './cirugias';
import { alertas, existencias } from './stock';

/**
 * Exportaciones a Excel.
 *
 * exceljs se importa de forma diferida: pesa bastante y solo hace falta cuando
 * alguien pide un reporte. Cargarlo en el modulo raiz encareceria el arranque
 * de todas las rutas, incluidas las del escaneo, que son las que tienen que
 * responder rapido.
 */

const GRIS_CABECERA = 'FFE2E8F0';

interface Columna {
  header: string;
  key: string;
  width: number;
}

function armarHoja(libro: Workbook, nombre: string, columnas: Columna[]): Worksheet {
  const hoja = libro.addWorksheet(nombre);
  hoja.columns = columnas;

  const cabecera = hoja.getRow(1);
  cabecera.font = { bold: true };
  cabecera.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CABECERA } };
  cabecera.alignment = { vertical: 'middle' };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

  return hoja;
}

/** Fechas legibles y ordenables. El Excel lo mira gente, no una maquina. */
function fecha(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function legible(texto: string | null): string {
  return (texto ?? '').replace(/_/g, ' ');
}

async function nuevoLibro(titulo: string): Promise<Workbook> {
  const ExcelJS = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de instrumentacion quirurgica';
  libro.created = new Date();
  libro.title = titulo;
  return libro;
}

async function aBytes(libro: Workbook): Promise<Uint8Array> {
  return new Uint8Array((await libro.xlsx.writeBuffer()) as ArrayBuffer);
}

export interface Reporte {
  nombreArchivo: string;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// 1. Stock
// ---------------------------------------------------------------------------

export async function reporteStock(db: Db, ahora: string, diasAviso = 60): Promise<Reporte> {
  const libro = await nuevoLibro('Stock de descartables');

  const resumen = armarHoja(libro, 'Existencias', [
    { header: 'Codigo', key: 'codigo', width: 16 },
    { header: 'Descartable', key: 'nombre', width: 38 },
    { header: 'Unidad', key: 'unidad', width: 12 },
    { header: 'Disponible', key: 'disponible', width: 12 },
    { header: 'Por vencer', key: 'porVencer', width: 12 },
    { header: 'Vencido sin descartar', key: 'vencido', width: 20 },
    { header: 'Punto de reposicion', key: 'punto', width: 18 },
    { header: 'Reponer', key: 'reponer', width: 10 },
  ]);

  for (const item of await existencias(db, ahora, diasAviso)) {
    const fila = resumen.addRow({
      codigo: item.codigo,
      nombre: item.nombre,
      unidad: item.unidad,
      disponible: item.disponible,
      porVencer: item.porVencer,
      vencido: item.vencidoSinDescartar,
      punto: item.puntoReposicion,
      reponer: item.necesitaReposicion ? 'SI' : '',
    });
    if (item.necesitaReposicion) {
      fila.getCell('reponer').font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
  }

  const porLote = armarHoja(libro, 'Lotes', [
    { header: 'Codigo', key: 'codigo', width: 16 },
    { header: 'Descartable', key: 'nombre', width: 38 },
    { header: 'Numero de lote', key: 'lote', width: 20 },
    { header: 'Vence', key: 'vence', width: 18 },
    { header: 'Cantidad inicial', key: 'inicial', width: 16 },
    { header: 'Saldo', key: 'saldo', width: 10 },
    { header: 'Recibido', key: 'recibido', width: 18 },
    { header: 'Estado', key: 'estado', width: 14 },
  ]);

  const lotes = await db
    .select({
      codigo: schema.descartable.codigo,
      nombre: schema.descartable.nombre,
      lote: schema.loteDescartable.numeroLote,
      vence: schema.loteDescartable.venceEl,
      inicial: schema.loteDescartable.cantidadInicial,
      saldo: schema.loteDescartable.cantidadActual,
      recibido: schema.loteDescartable.recibidoEn,
    })
    .from(schema.loteDescartable)
    .innerJoin(schema.descartable, eq(schema.descartable.id, schema.loteDescartable.descartableId))
    .orderBy(asc(schema.descartable.nombre), asc(schema.loteDescartable.venceEl));

  for (const lote of lotes) {
    const vencido = lote.vence !== null && lote.vence < ahora;
    porLote.addRow({
      ...lote,
      vence: fecha(lote.vence),
      recibido: fecha(lote.recibido),
      estado: lote.saldo === 0 ? 'agotado' : vencido ? 'VENCIDO' : 'vigente',
    });
  }

  const hojaAlertas = armarHoja(libro, 'Alertas', [
    { header: 'Tipo', key: 'tipo', width: 18 },
    { header: 'Descartable', key: 'descartable', width: 38 },
    { header: 'Numero de lote', key: 'lote', width: 20 },
    { header: 'Vence', key: 'vence', width: 18 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Detalle', key: 'detalle', width: 40 },
  ]);

  const datos = await alertas(db, ahora, diasAviso);
  for (const item of datos.reposicion) {
    hojaAlertas.addRow({
      tipo: 'Reposicion',
      descartable: item.nombre,
      cantidad: item.disponible,
      detalle: `Punto de reposicion: ${item.puntoReposicion}`,
    });
  }
  for (const item of datos.porVencer) {
    hojaAlertas.addRow({
      tipo: 'Por vencer',
      descartable: item.descartable,
      lote: item.numeroLote,
      vence: fecha(item.venceEl),
      cantidad: item.cantidad,
      detalle: `Quedan ${item.diasRestantes} dias`,
    });
  }
  for (const item of datos.vencidos) {
    hojaAlertas.addRow({
      tipo: 'VENCIDO',
      descartable: item.descartable,
      lote: item.numeroLote,
      vence: fecha(item.venceEl),
      cantidad: item.cantidad,
      detalle: 'Hay que darlo de baja',
    });
  }

  return {
    nombreArchivo: `stock-${ahora.slice(0, 10)}.xlsx`,
    bytes: await aBytes(libro),
  };
}

// ---------------------------------------------------------------------------
// 2. Trazabilidad de una cirugia
// ---------------------------------------------------------------------------

export async function reporteCirugia(db: Db, cirugiaId: string): Promise<Reporte> {
  const datos = await trazabilidad(db, cirugiaId);
  const libro = await nuevoLibro(`Trazabilidad ${datos.cirugia.pacienteRef}`);

  const resumen = libro.addWorksheet('Cirugia');
  resumen.columns = [
    { header: '', key: 'campo', width: 26 },
    { header: '', key: 'valor', width: 46 },
  ];
  // Sin datos clinicos: de un paciente solo existe el identificador opaco.
  const filas: [string, string][] = [
    ['Referencia de paciente', datos.cirugia.pacienteRef],
    ['Quirofano', datos.cirugia.quirofano ?? ''],
    ['Programada para', fecha(datos.cirugia.programadaPara)],
    ['Estado', legible(datos.cirugia.estado)],
    ['Notas', datos.cirugia.notas ?? ''],
  ];
  for (const [campo, valor] of filas) {
    const fila = resumen.addRow({ campo, valor });
    fila.getCell('campo').font = { bold: true };
  }

  const cajas = armarHoja(libro, 'Cajas', [
    { header: 'Codigo', key: 'codigo', width: 14 },
    { header: 'Nombre', key: 'nombre', width: 34 },
    { header: 'Estado actual', key: 'estado', width: 20 },
    { header: 'Usada en el paciente', key: 'usada', width: 20 },
  ]);
  for (const caja of datos.cirugia.cajas) {
    cajas.addRow({
      codigo: caja.codigo,
      nombre: caja.nombre,
      estado: legible(caja.estado),
      usada: caja.usada ? 'SI' : 'no',
    });
  }

  const movimientos = armarHoja(libro, 'Movimientos', [
    { header: 'Caja', key: 'codigo', width: 14 },
    { header: 'Desde', key: 'desde', width: 20 },
    { header: 'Hasta', key: 'hasta', width: 20 },
    { header: 'Ocurrido', key: 'ocurrido', width: 18 },
    { header: 'Registro', key: 'usuario', width: 26 },
  ]);
  for (const mov of datos.movimientos) {
    movimientos.addRow({
      codigo: mov.codigo,
      desde: legible(mov.estadoDesde),
      hasta: legible(mov.estadoHasta),
      ocurrido: fecha(mov.ocurridoEn),
      usuario: mov.usuario,
    });
  }

  const ciclos = armarHoja(libro, 'Esterilizacion', [
    { header: 'Caja', key: 'codigo', width: 14 },
    { header: 'Lote', key: 'lote', width: 18 },
    { header: 'Metodo', key: 'metodo', width: 18 },
    { header: 'Control biologico', key: 'biologico', width: 18 },
    { header: 'Liberado', key: 'liberado', width: 18 },
  ]);
  for (const ciclo of datos.ciclos) {
    const fila = ciclos.addRow({
      codigo: ciclo.codigo,
      lote: ciclo.numeroLote,
      metodo: legible(ciclo.metodo),
      biologico: legible(ciclo.controlBiologico),
      liberado: fecha(ciclo.liberadoEn),
    });
    if (ciclo.controlBiologico === 'no_conforme') {
      fila.font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
  }

  const consumos = armarHoja(libro, 'Descartables', [
    { header: 'Codigo', key: 'codigo', width: 16 },
    { header: 'Descartable', key: 'descartable', width: 38 },
    { header: 'Numero de lote', key: 'lote', width: 20 },
    { header: 'Vence', key: 'vence', width: 18 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Momento', key: 'ocurrido', width: 18 },
  ]);
  for (const consumo of datos.consumos) {
    consumos.addRow({
      codigo: consumo.codigo,
      descartable: consumo.descartable,
      lote: consumo.numeroLote,
      vence: fecha(consumo.venceEl),
      cantidad: consumo.tipo === 'devolucion' ? -consumo.cantidad : consumo.cantidad,
      ocurrido: fecha(consumo.ocurridoEn),
    });
  }

  return {
    nombreArchivo: `trazabilidad-${datos.cirugia.pacienteRef}.xlsx`,
    bytes: await aBytes(libro),
  };
}

// ---------------------------------------------------------------------------
// 3. Historial de una caja
// ---------------------------------------------------------------------------

export async function reporteCaja(db: Db, ref: string): Promise<Reporte> {
  const caja = await resolverCaja(db, ref);
  if (!caja) throw new ErrorDeNegocio('caja_inexistente', `No hay ninguna caja "${ref}"`);

  const libro = await nuevoLibro(`Historial ${caja.codigo}`);

  const ficha = libro.addWorksheet('Caja');
  ficha.columns = [
    { header: '', key: 'campo', width: 24 },
    { header: '', key: 'valor', width: 44 },
  ];
  for (const [campo, valor] of [
    ['Codigo', caja.codigo],
    ['Nombre', caja.nombre],
    ['Servicio', caja.servicio ?? ''],
    ['Estado actual', legible(caja.estado)],
    ['Ubicacion', caja.ubicacion ?? ''],
    ['Vence', fecha(caja.venceEl)],
    ['Ciclos totales', String(caja.ciclosTotales)],
    ['Activa', caja.activa === 1 ? 'SI' : 'no'],
  ] as [string, string][]) {
    ficha.addRow({ campo, valor }).getCell('campo').font = { bold: true };
  }

  const contenido = armarHoja(libro, 'Contenido esperado', [
    { header: 'Codigo', key: 'codigo', width: 16 },
    { header: 'Instrumento', key: 'nombre', width: 40 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Termosensible', key: 'termo', width: 16 },
  ]);
  const lineas = await db
    .select({
      codigo: schema.instrumentoTipo.codigo,
      nombre: schema.instrumentoTipo.nombre,
      cantidad: schema.cajaContenido.cantidad,
      termo: schema.instrumentoTipo.termosensible,
    })
    .from(schema.cajaContenido)
    .innerJoin(
      schema.instrumentoTipo,
      eq(schema.instrumentoTipo.id, schema.cajaContenido.instrumentoTipoId),
    )
    .where(eq(schema.cajaContenido.cajaId, caja.id))
    .orderBy(asc(schema.instrumentoTipo.nombre));
  for (const linea of lineas) {
    contenido.addRow({ ...linea, termo: linea.termo === 1 ? 'SI' : '' });
  }

  const historial = armarHoja(libro, 'Historial', [
    { header: 'Desde', key: 'desde', width: 20 },
    { header: 'Hasta', key: 'hasta', width: 20 },
    { header: 'Ocurrido', key: 'ocurrido', width: 18 },
    { header: 'Registrado', key: 'registrado', width: 18 },
    { header: 'Quien', key: 'usuario', width: 26 },
    { header: 'Lote de esterilizacion', key: 'lote', width: 22 },
    { header: 'Paciente', key: 'paciente', width: 16 },
    { header: 'Observacion', key: 'observacion', width: 48 },
  ]);

  // ocurrido_en y registrado_en van los dos: la diferencia entre ambos es lo
  // que muestra que ese escaneo se hizo sin señal y se sincronizo despues.
  const movimientos = await db
    .select({
      desde: schema.movimientoCaja.estadoDesde,
      hasta: schema.movimientoCaja.estadoHasta,
      ocurrido: schema.movimientoCaja.ocurridoEn,
      registrado: schema.movimientoCaja.registradoEn,
      usuario: schema.usuario.nombre,
      lote: schema.cicloEsterilizacion.numeroLote,
      paciente: schema.cirugia.pacienteRef,
      observacion: schema.movimientoCaja.observacion,
    })
    .from(schema.movimientoCaja)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.movimientoCaja.usuarioId))
    .leftJoin(
      schema.cicloEsterilizacion,
      eq(schema.cicloEsterilizacion.id, schema.movimientoCaja.cicloId),
    )
    .leftJoin(schema.cirugia, eq(schema.cirugia.id, schema.movimientoCaja.cirugiaId))
    .where(eq(schema.movimientoCaja.cajaId, caja.id))
    .orderBy(desc(schema.movimientoCaja.ocurridoEn));

  for (const mov of movimientos) {
    historial.addRow({
      desde: legible(mov.desde),
      hasta: legible(mov.hasta),
      ocurrido: fecha(mov.ocurrido),
      registrado: fecha(mov.registrado),
      usuario: mov.usuario,
      lote: mov.lote ?? '',
      paciente: mov.paciente ?? '',
      observacion: mov.observacion ?? '',
    });
  }

  return { nombreArchivo: `historial-${caja.codigo}.xlsx`, bytes: await aBytes(libro) };
}

// ---------------------------------------------------------------------------
// 4. Productividad por ciclo
// ---------------------------------------------------------------------------

export async function reporteCiclos(
  db: Db,
  filtros: { desde?: string | undefined; hasta?: string | undefined },
): Promise<Reporte> {
  const libro = await nuevoLibro('Productividad de esterilizacion');

  const condiciones = [];
  if (filtros.desde) condiciones.push(gte(schema.cicloEsterilizacion.iniciadoEn, filtros.desde));
  if (filtros.hasta) condiciones.push(lte(schema.cicloEsterilizacion.iniciadoEn, filtros.hasta));

  const ciclos = await db
    .select({
      id: schema.cicloEsterilizacion.id,
      lote: schema.cicloEsterilizacion.numeroLote,
      equipo: schema.equipoEsterilizador.nombre,
      metodo: schema.cicloEsterilizacion.metodo,
      iniciado: schema.cicloEsterilizacion.iniciadoEn,
      finalizado: schema.cicloEsterilizacion.finalizadoEn,
      temperatura: schema.cicloEsterilizacion.temperaturaC,
      tiempo: schema.cicloEsterilizacion.tiempoMin,
      fisico: schema.cicloEsterilizacion.controlFisico,
      quimico: schema.cicloEsterilizacion.controlQuimico,
      biologico: schema.cicloEsterilizacion.controlBiologico,
      liberado: schema.cicloEsterilizacion.liberadoEn,
      operador: schema.usuario.nombre,
    })
    .from(schema.cicloEsterilizacion)
    .innerJoin(
      schema.equipoEsterilizador,
      eq(schema.equipoEsterilizador.id, schema.cicloEsterilizacion.equipoId),
    )
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.cicloEsterilizacion.operadorId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(schema.cicloEsterilizacion.iniciadoEn));

  const detalle = armarHoja(libro, 'Ciclos', [
    { header: 'Lote', key: 'lote', width: 18 },
    { header: 'Equipo', key: 'equipo', width: 24 },
    { header: 'Metodo', key: 'metodo', width: 18 },
    { header: 'Cajas', key: 'cajas', width: 8 },
    { header: 'Iniciado', key: 'iniciado', width: 18 },
    { header: 'Finalizado', key: 'finalizado', width: 18 },
    { header: 'Duracion (min)', key: 'duracion', width: 14 },
    { header: 'Temp (C)', key: 'temperatura', width: 10 },
    { header: 'Fisico', key: 'fisico', width: 12 },
    { header: 'Quimico', key: 'quimico', width: 12 },
    { header: 'Biologico', key: 'biologico', width: 14 },
    { header: 'Liberado', key: 'liberado', width: 18 },
    { header: 'Espera hasta liberar (h)', key: 'espera', width: 22 },
    { header: 'Operador', key: 'operador', width: 26 },
  ]);

  const porEquipo = new Map<string, { ciclos: number; cajas: number; noConformes: number }>();

  for (const ciclo of ciclos) {
    const [conteo] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.cicloCaja)
      .where(eq(schema.cicloCaja.cicloId, ciclo.id));
    const cajas = conteo?.n ?? 0;

    const duracion =
      ciclo.finalizado && ciclo.iniciado
        ? Math.round(
            (new Date(ciclo.finalizado).getTime() - new Date(ciclo.iniciado).getTime()) / 60000,
          )
        : null;

    // Cuanto tardo el lote en quedar disponible. Es la metrica que dice si la
    // central es un cuello de botella o no.
    const espera =
      ciclo.liberado && ciclo.finalizado
        ? Math.round(
            ((new Date(ciclo.liberado).getTime() - new Date(ciclo.finalizado).getTime()) / 3600000) *
              10,
          ) / 10
        : null;

    const fila = detalle.addRow({
      lote: ciclo.lote,
      equipo: ciclo.equipo,
      metodo: legible(ciclo.metodo),
      cajas,
      iniciado: fecha(ciclo.iniciado),
      finalizado: fecha(ciclo.finalizado),
      duracion: duracion ?? '',
      temperatura: ciclo.temperatura ?? '',
      fisico: legible(ciclo.fisico),
      quimico: legible(ciclo.quimico),
      biologico: legible(ciclo.biologico),
      liberado: fecha(ciclo.liberado),
      espera: espera ?? '',
      operador: ciclo.operador,
    });

    if (ciclo.biologico === 'no_conforme') {
      fila.font = { bold: true, color: { argb: 'FFB91C1C' } };
    }

    const acumulado = porEquipo.get(ciclo.equipo) ?? { ciclos: 0, cajas: 0, noConformes: 0 };
    acumulado.ciclos += 1;
    acumulado.cajas += cajas;
    if (ciclo.biologico === 'no_conforme') acumulado.noConformes += 1;
    porEquipo.set(ciclo.equipo, acumulado);
  }

  const resumen = armarHoja(libro, 'Por equipo', [
    { header: 'Equipo', key: 'equipo', width: 26 },
    { header: 'Ciclos', key: 'ciclos', width: 10 },
    { header: 'Cajas procesadas', key: 'cajas', width: 18 },
    { header: 'Cajas por ciclo', key: 'promedio', width: 16 },
    { header: 'Biologicos no conformes', key: 'noConformes', width: 24 },
  ]);
  for (const [equipo, datos] of porEquipo) {
    resumen.addRow({
      equipo,
      ciclos: datos.ciclos,
      cajas: datos.cajas,
      promedio: datos.ciclos > 0 ? Math.round((datos.cajas / datos.ciclos) * 10) / 10 : 0,
      noConformes: datos.noConformes,
    });
  }

  return { nombreArchivo: 'productividad-esterilizacion.xlsx', bytes: await aBytes(libro) };
}
