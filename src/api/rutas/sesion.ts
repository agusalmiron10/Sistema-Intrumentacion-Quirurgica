import { Hono } from 'hono';

import { firmarSesion } from '../../auth/sesion';
import { crearDb } from '../../db';
import { autenticar, listarParaElegir } from '../../servicios/usuarios';
import { ingresoSchema } from '../esquemas';
import { secretoDeSesion, requiereSesion, type Entorno } from '../middleware';
import { leerJson } from '../validacion';

export const rutasSesion = new Hono<Entorno>();

/** Lista para la pantalla de ingreso: se elige el usuario y despues el PIN. */
rutasSesion.get('/usuarios', async (c) => {
  return c.json(await listarParaElegir(crearDb(c.env.DB)));
});

rutasSesion.post('/sesion', async (c) => {
  const cuerpo = await leerJson(c, ingresoSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const resultado = await autenticar(
    crearDb(c.env.DB),
    cuerpo.datos.usuarioId,
    cuerpo.datos.pin,
  );

  if (!resultado.ok) {
    if (resultado.motivo === 'bloqueado') {
      return c.json(
        {
          error: 'bloqueado',
          mensaje: 'Demasiados intentos fallidos. Probar de nuevo en unos minutos.',
          bloqueadoHasta: resultado.bloqueadoHasta,
        },
        429,
      );
    }
    return c.json(
      {
        error: 'credenciales',
        mensaje: 'PIN incorrecto',
        intentosRestantes: resultado.intentosRestantes,
      },
      401,
    );
  }

  return c.json({
    token: await firmarSesion(secretoDeSesion(c.env), resultado.usuarioId, resultado.rol),
    usuario: { id: resultado.usuarioId, nombre: resultado.nombre, rol: resultado.rol },
  });
});

/** Permite a la PWA saber si el token que tiene guardado sigue sirviendo. */
rutasSesion.get('/sesion', requiereSesion, (c) => {
  const sesion = c.get('sesion');
  return c.json({ usuarioId: sesion.usuarioId, rol: sesion.rol, exp: sesion.exp });
});
