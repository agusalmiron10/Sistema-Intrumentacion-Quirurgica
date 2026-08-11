import { describe, expect, it } from 'vitest';

import { interpretarErrorD1, interpretarErrorDeTrigger } from '../src/api/errores';

/**
 * Estos mensajes terminan en la pantalla de la instrumentadora, en la lista de
 * conflictos. Tienen que leerse como una frase, no como un volcado del driver.
 */

/** Reproduce como envuelve drizzle el error del driver de D1. */
function comoLoEnvuelveDrizzle(mensajeDelTrigger: string): Error {
  const raiz = new Error(`${mensajeDelTrigger}: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`);
  const delDriver = new Error(`D1_ERROR: ${raiz.message}`, { cause: raiz });
  return new Error('Failed query: insert into "movimiento_caja" ...', { cause: delDriver });
}

describe('interpretacion de los abortos de trigger', () => {
  it('encuentra el slug aunque este enterrado en la cadena de causas', () => {
    const error = comoLoEnvuelveDrizzle(
      'conflicto_estado: el estado_desde del evento no coincide con el estado actual de la caja',
    );

    const resultado = interpretarErrorDeTrigger(error);
    expect(resultado?.codigo).toBe('conflicto_estado');
    expect(resultado?.estadoHttp).toBe(409);
  });

  it('limpia el ruido del driver y no repite el mensaje', () => {
    const error = comoLoEnvuelveDrizzle(
      'transicion_invalida: esa transicion de estado no existe en la maquina de estados',
    );

    const mensaje = interpretarErrorDeTrigger(error)?.mensaje ?? '';
    expect(mensaje).toBe('esa transicion de estado no existe en la maquina de estados');
    expect(mensaje).not.toContain('SQLITE');
    expect(mensaje).not.toContain('|');
    expect(mensaje).not.toContain('D1_ERROR');
  });

  it('reconoce una clave duplicada', () => {
    const error = new Error('Failed query', {
      cause: new Error('D1_ERROR: UNIQUE constraint failed: caja.codigo'),
    });

    const resultado = interpretarErrorD1(error);
    expect(resultado?.codigo).toBe('duplicado');
    expect(resultado?.estadoHttp).toBe(409);
  });

  it('reconoce una referencia inexistente', () => {
    const error = new Error('Failed query', {
      cause: new Error('D1_ERROR: FOREIGN KEY constraint failed'),
    });
    expect(interpretarErrorD1(error)?.codigo).toBe('referencia_inexistente');
  });

  it('devuelve null si el error no es culpa del pedido', () => {
    // Un bug nuestro tiene que salir como 500, no disfrazarse de 4xx.
    expect(interpretarErrorD1(new Error('undefined is not a function'))).toBeNull();
    expect(interpretarErrorDeTrigger(new Error('network timeout'))).toBeNull();
  });

  it('no se cuelga con una cadena de causas circular', () => {
    const a = new Error('uno');
    const b = new Error('dos', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(interpretarErrorD1(a)).toBeNull();
  });
});
