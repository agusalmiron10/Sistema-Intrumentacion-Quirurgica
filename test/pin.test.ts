import { describe, expect, it } from 'vitest';

import { hashPin, MAX_ITERACIONES_WORKERS, verificarPin } from '../src/auth/pin';

describe('derivacion del PIN', () => {
  /**
   * Este test existe por un bug que solo aparecio en produccion.
   *
   * El codigo usaba 210.000 iteraciones (la recomendacion de OWASP) y andaba
   * perfecto en local, porque workerd local no aplica el limite. El runtime
   * desplegado si: responde `NotSupportedError: iteration counts above 100000
   * are not supported` y devuelve 500. Resultado: nadie podia crear un usuario
   * ni entrar, y el unico sintoma visible era un mensaje generico en pantalla.
   *
   * Como el limite no se puede ejercitar en los tests, se afirma sobre el
   * numero directamente.
   */
  it('no supera el tope de iteraciones del runtime de Workers', async () => {
    const hash = await hashPin('1234');
    const iteraciones = Number.parseInt(hash.split('$')[2] ?? '0', 10);

    expect(iteraciones).toBeLessThanOrEqual(MAX_ITERACIONES_WORKERS);
    expect(iteraciones).toBeGreaterThan(0);
  });

  it('el formato del hash es el esperado', async () => {
    const hash = await hashPin('4821');
    const partes = hash.split('$');

    expect(partes).toHaveLength(5);
    expect(partes[0]).toBe('pbkdf2');
    expect(partes[1]).toBe('sha256');
    // El PIN en claro no aparece por ningun lado.
    expect(hash).not.toContain('4821');
  });

  it('verifica el PIN correcto y rechaza el equivocado', async () => {
    const hash = await hashPin('4821');

    expect(await verificarPin('4821', hash)).toBe(true);
    expect(await verificarPin('4822', hash)).toBe(false);
    expect(await verificarPin('482', hash)).toBe(false);
  });

  it('dos hashes del mismo PIN son distintos', async () => {
    // Salt aleatorio: si fueran iguales, la misma tabla arcoiris serviria para
    // todos los usuarios que eligieron el mismo PIN.
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('un hash imposible de verificar devuelve false en vez de explotar', async () => {
    // Un hash viejo con mas iteraciones de las que el runtime admite tiene que
    // fallar como PIN incorrecto, no como 500.
    const inverificable = `pbkdf2$sha256$999999999$c2FsdA==$aGFzaA==`;
    expect(await verificarPin('1234', inverificable)).toBe(false);
  });

  it('no explota con basura', async () => {
    for (const basura of ['', 'x', 'a$b$c', 'pbkdf2$sha256$abc$d$e', 'pbkdf2$md5$1000$a$b']) {
      expect(await verificarPin('1234', basura)).toBe(false);
    }
  });

  it('rechaza PIN con formato invalido al generar el hash', async () => {
    for (const malo of ['123', '1234567', 'abcd', '']) {
      await expect(hashPin(malo)).rejects.toThrow(/4 y 6 digitos/);
    }
  });
});
