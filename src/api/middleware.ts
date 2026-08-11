import { createMiddleware } from 'hono/factory';

import { verificarSesion, type Sesion } from '../auth/sesion';

export interface Variables {
  sesion: Sesion;
}

export type Entorno = { Bindings: Cloudflare.Env; Variables: Variables };

/**
 * Valores que alguna vez estuvieron en un archivo versionado o en un ejemplo.
 * Cualquiera que lea el repositorio los conoce, asi que firmar con ellos
 * equivale a no firmar: se rechazan explicito en vez de dejar el sistema
 * funcionando con una puerta abierta que nadie ve.
 */
const SECRETOS_QUEMADOS = new Set([
  'desarrollo-inseguro-cambiar-en-produccion',
  'solo-para-desarrollo-local-no-usar-en-produccion',
]);

/** Secreto de firma. Falla cerrado: sin secreto valido no se emite sesion. */
export function secretoDeSesion(env: Cloudflare.Env): string {
  const secreto = env.SESION_SECRET?.trim();

  if (!secreto) {
    throw new Error(
      'Falta SESION_SECRET. En produccion: wrangler secret put SESION_SECRET. ' +
        'En local: copiar .dev.vars.example a .dev.vars',
    );
  }

  if (SECRETOS_QUEMADOS.has(secreto) && env.DOMINIO_PUBLICO) {
    // El dominio publico configurado indica que esto es un despliegue real y
    // no `wrangler dev`.
    throw new Error(
      'SESION_SECRET es un valor de ejemplo publico. Generar uno propio con ' +
        'wrangler secret put SESION_SECRET',
    );
  }

  return secreto;
}

export const requiereSesion = createMiddleware<Entorno>(async (c, next) => {
  const cabecera = c.req.header('Authorization') ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';

  if (!token) {
    return c.json({ error: 'sin_sesion', mensaje: 'Falta el token de sesion' }, 401);
  }

  const sesion = await verificarSesion(secretoDeSesion(c.env), token);
  if (!sesion) {
    return c.json(
      { error: 'sesion_invalida', mensaje: 'La sesion vencio o el token no es valido' },
      401,
    );
  }

  c.set('sesion', sesion);
  await next();
});
