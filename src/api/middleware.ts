import { createMiddleware } from 'hono/factory';

import { verificarSesion, type Sesion } from '../auth/sesion';

export interface Variables {
  sesion: Sesion;
}

export type Entorno = { Bindings: Cloudflare.Env; Variables: Variables };

/** Secreto de firma. Se exige explicito para no firmar con algo vacio. */
export function secretoDeSesion(env: Cloudflare.Env): string {
  const secreto = env.SESION_SECRET?.trim();
  if (!secreto) throw new Error('Falta configurar SESION_SECRET');
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
