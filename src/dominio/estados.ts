/**
 * Vocabulario del dominio y maquina de estados de las cajas.
 *
 * Esta es la definicion canonica en TypeScript. La base de datos tiene su
 * propia copia (tabla `transicion_valida` + CHECK constraints) y es la
 * autoridad final: el cliente valida con esto para dar feedback inmediato,
 * pero un evento solo existe si el trigger de D1 lo acepta.
 */

export const ESTADOS_CAJA = [
  'esteril_deposito',
  'asignada',
  'en_quirofano',
  'usada_sucia',
  'en_lavado',
  'en_armado',
  'en_esterilizacion',
  'en_cuarentena',
  'en_reparacion',
  'baja',
] as const;
export type EstadoCaja = (typeof ESTADOS_CAJA)[number];

/**
 * Transiciones permitidas.
 *
 * `asignada -> en_lavado` no estaba en la especificacion original: se agrego
 * para poder hacer el recall de una caja que ya fue asignada a una cirugia
 * cuando su ciclo sale con control biologico no conforme. Sin esa arista el
 * retiro del lote contaminado era imposible.
 *
 * Una caja que ya esta `en_quirofano` no se fuerza: sigue su curso natural
 * (`usada_sucia -> en_lavado`) y la cirugia queda marcada como afectada.
 *
 * `baja` es terminal: no tiene aristas de salida a proposito.
 */
export const TRANSICIONES: Readonly<Record<EstadoCaja, readonly EstadoCaja[]>> = {
  esteril_deposito: ['asignada', 'en_lavado'],
  asignada: ['en_quirofano', 'esteril_deposito', 'en_lavado'],
  en_quirofano: ['usada_sucia', 'esteril_deposito'],
  usada_sucia: ['en_lavado'],
  en_lavado: ['en_armado'],
  en_armado: ['en_esterilizacion', 'en_reparacion'],
  en_esterilizacion: ['en_cuarentena'],
  en_cuarentena: ['esteril_deposito', 'en_lavado'],
  en_reparacion: ['en_armado', 'baja'],
  baja: [],
};

/** Transicion que ademas exige control biologico conforme del ultimo ciclo. */
export function requiereControlBiologico(desde: EstadoCaja, hasta: EstadoCaja): boolean {
  return desde === 'en_cuarentena' && hasta === 'esteril_deposito';
}

/** Transicion que exige que la caja no este vencida al momento del escaneo. */
export function requiereVigencia(_desde: EstadoCaja, hasta: EstadoCaja): boolean {
  return hasta === 'asignada';
}

export function esTransicionValida(desde: EstadoCaja, hasta: EstadoCaja): boolean {
  return TRANSICIONES[desde].includes(hasta);
}

/** Pares (desde, hasta) aplanados, para sembrar la tabla `transicion_valida`. */
export function transicionesPlanas(): ReadonlyArray<{
  estadoDesde: EstadoCaja;
  estadoHasta: EstadoCaja;
}> {
  return ESTADOS_CAJA.flatMap((desde) =>
    TRANSICIONES[desde].map((hasta) => ({ estadoDesde: desde, estadoHasta: hasta })),
  );
}

export const ROLES_USUARIO = ['instrumentadora', 'esterilizacion', 'supervisor', 'admin'] as const;
export type RolUsuario = (typeof ROLES_USUARIO)[number];

export const METODOS_ESTERILIZACION = [
  'vapor_134',
  'vapor_121',
  'oxido_etileno',
  'peroxido_plasma',
] as const;
export type MetodoEsterilizacion = (typeof METODOS_ESTERILIZACION)[number];

export const RESULTADOS_CONTROL = ['pendiente', 'conforme', 'no_conforme'] as const;
export type ResultadoControl = (typeof RESULTADOS_CONTROL)[number];

export const TIPOS_MOVIMIENTO_STOCK = [
  'ingreso',
  'consumo',
  'devolucion',
  'vencido',
  'ajuste',
] as const;
export type TipoMovimientoStock = (typeof TIPOS_MOVIMIENTO_STOCK)[number];

export const ESTADOS_CIRUGIA = [
  'programada',
  'preparada',
  'en_curso',
  'finalizada',
  'suspendida',
] as const;
export type EstadoCirugia = (typeof ESTADOS_CIRUGIA)[number];

/**
 * Signo con el que cada tipo de movimiento afecta el saldo del lote.
 * Debe coincidir exactamente con el CASE del trigger `ms_aplica_saldo`.
 */
export const SIGNO_MOVIMIENTO_STOCK: Readonly<Record<TipoMovimientoStock, 1 | -1>> = {
  ingreso: 1,
  devolucion: 1,
  consumo: -1,
  vencido: -1,
  ajuste: 1, // el ajuste viaja firmado: la cantidad puede ser negativa
};
