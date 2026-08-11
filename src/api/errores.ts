/**
 * Traduccion de los abortos de los triggers a respuestas HTTP.
 *
 * Los mensajes de RAISE(ABORT) empiezan con un slug estable (ver
 * migrations/0501_triggers.sql) justamente para no tener que parsear prosa
 * ni depender de la traduccion del driver.
 */

export const CODIGOS_DOMINIO = [
  'conflicto_estado',
  'transicion_invalida',
  'caja_vencida',
  'caja_inactiva',
  'control_biologico_no_conforme',
  'estado_no_modificable',
  'append_only',
  'stock_insuficiente',
  'saldo_no_modificable',
  'control_ya_registrado',
] as const;
export type CodigoDominio = (typeof CODIGOS_DOMINIO)[number];

const ESTADO_HTTP: Readonly<Record<CodigoDominio, 409 | 422 | 403>> = {
  // El evento llego tarde y la caja ya avanzo: es un conflicto, no un error de
  // la usuaria. La API nunca lo descarta, lo devuelve para mostrarlo.
  conflicto_estado: 409,
  transicion_invalida: 422,
  caja_vencida: 422,
  caja_inactiva: 422,
  control_biologico_no_conforme: 422,
  estado_no_modificable: 403,
  append_only: 403,
  stock_insuficiente: 422,
  saldo_no_modificable: 403,
  control_ya_registrado: 409,
};

export interface ErrorDominio {
  codigo: CodigoDominio;
  mensaje: string;
  estadoHttp: 409 | 422 | 403;
}

/**
 * Reconoce un abort de trigger. Devuelve null si el error es otra cosa
 * (problema de red, bug, violacion de FK), que debe propagarse como 500.
 */
export function interpretarErrorDeTrigger(error: unknown): ErrorDominio | null {
  const texto = error instanceof Error ? error.message : String(error);
  for (const codigo of CODIGOS_DOMINIO) {
    const marca = `${codigo}:`;
    const posicion = texto.indexOf(marca);
    if (posicion !== -1) {
      return {
        codigo,
        mensaje: texto.slice(posicion + marca.length).trim(),
        estadoHttp: ESTADO_HTTP[codigo],
      };
    }
  }
  return null;
}

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  estadoHttp: 409 | 422 | 403;
}

/**
 * Interpreta cualquier error de D1 que sea culpa del pedido y no del sistema:
 * abortos de trigger, claves duplicadas y referencias inexistentes.
 * Devuelve null si el error es otra cosa, que debe salir como 500.
 */
export function interpretarErrorD1(error: unknown): ErrorApi | null {
  const deTrigger = interpretarErrorDeTrigger(error);
  if (deTrigger) return deTrigger;

  const texto = error instanceof Error ? error.message : String(error);

  if (texto.includes('UNIQUE constraint failed')) {
    const columna = /UNIQUE constraint failed: ([\w.,\s]+)/.exec(texto)?.[1]?.trim();
    return {
      codigo: 'duplicado',
      mensaje: columna ? `Ya existe un registro con ese valor en ${columna}` : 'Valor duplicado',
      estadoHttp: 409,
    };
  }

  if (texto.includes('FOREIGN KEY constraint failed')) {
    return {
      codigo: 'referencia_inexistente',
      mensaje: 'Alguno de los registros referenciados no existe',
      estadoHttp: 422,
    };
  }

  if (texto.includes('CHECK constraint failed')) {
    const nombre = /CHECK constraint failed: (\w+)/.exec(texto)?.[1];
    return {
      codigo: 'check_invalido',
      mensaje: nombre ? `No se cumple la restriccion ${nombre}` : 'Valor fuera de lo permitido',
      estadoHttp: 422,
    };
  }

  return null;
}
