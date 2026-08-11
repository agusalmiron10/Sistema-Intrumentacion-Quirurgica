import type { Context } from 'hono';

import { interpretarErrorD1 } from './errores';
import type { Entorno } from './middleware';

/**
 * Error de negocio con un slug estable, en la misma linea que los abortos de
 * trigger: la API nunca devuelve prosa suelta que el cliente tenga que parsear.
 */
export class ErrorDeNegocio extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorDeNegocio';
  }
}

/** Codigos que significan "no existe" y por lo tanto van como 404. */
const NO_ENCONTRADO = new Set([
  'ciclo_inexistente',
  'cirugia_inexistente',
  'plantilla_inexistente',
  'caja_inexistente',
  'descartable_inexistente',
  'lote_inexistente',
]);

/** Codigos que significan "ya paso" y por lo tanto van como 409. */
const CONFLICTO = new Set(['ciclo_ya_liberado', 'ciclo_ya_finalizado']);

export function responderError(c: Context<Entorno>, error: unknown): Response {
  if (error instanceof ErrorDeNegocio) {
    const estado = NO_ENCONTRADO.has(error.codigo) ? 404 : CONFLICTO.has(error.codigo) ? 409 : 422;
    return c.json({ error: error.codigo, mensaje: error.message, detalle: error.detalle }, estado);
  }

  const interpretado = interpretarErrorD1(error);
  if (interpretado) {
    return c.json(
      { error: interpretado.codigo, mensaje: interpretado.mensaje },
      interpretado.estadoHttp,
    );
  }

  // No es culpa del pedido: que salga como 500 y quede en los logs.
  throw error;
}
