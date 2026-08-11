import { Hono } from 'hono';

import { firmarSesion } from '../../auth/sesion';
import { crearDb } from '../../db';
import {
  actualizarUsuario,
  adminsActivos,
  configurarPrimerAdmin,
  crearUsuario,
  hayUsuarios,
  listarTodos,
} from '../../servicios/usuarios';
import {
  actualizarUsuarioSchema,
  configuracionInicialSchema,
  crearUsuarioSchema,
} from '../esquemas';
import { requiereSesion, secretoDeSesion, type Entorno } from '../middleware';
import { responderError } from '../respuestas';
import { leerJson } from '../validacion';

export const rutasUsuarios = new Hono<Entorno>();

/** Le dice a la aplicacion si tiene que mostrar la pantalla de configuracion. */
rutasUsuarios.get('/setup', async (c) => {
  return c.json({ requiereConfiguracion: !(await hayUsuarios(crearDb(c.env.DB))) });
});

/**
 * Crea el primer administrador.
 *
 * Es el unico endpoint que escribe sin sesion, y solo funciona mientras no
 * exista ningun usuario. En cuanto hay uno, responde 409 para siempre.
 */
rutasUsuarios.post('/setup', async (c) => {
  const cuerpo = await leerJson(c, configuracionInicialSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);

  try {
    const resultado = await configurarPrimerAdmin(db, cuerpo.datos);

    if (!resultado.ok) {
      return c.json(
        {
          error: 'ya_configurado',
          mensaje: 'El sistema ya tiene usuarios. Pedile a un administrador que te de de alta.',
        },
        409,
      );
    }

    // Se devuelve la sesion ya iniciada: obligar a ingresar el PIN que se
    // acaba de elegir seria un paso al pedo.
    return c.json(
      {
        token: await firmarSesion(secretoDeSesion(c.env), resultado.usuarioId, 'admin'),
        usuario: { id: resultado.usuarioId, nombre: cuerpo.datos.nombre, rol: 'admin' },
      },
      201,
    );
  } catch (error) {
    return responderError(c, error);
  }
});

/** Solo admin: el resto de los roles no administra usuarios. */
const soloAdmin = (rol: string): boolean => rol === 'admin';

rutasUsuarios.get('/admin/usuarios', requiereSesion, async (c) => {
  if (!soloAdmin(c.get('sesion').rol)) {
    return c.json({ error: 'rol_insuficiente', mensaje: 'Solo un administrador' }, 403);
  }
  return c.json(await listarTodos(crearDb(c.env.DB)));
});

rutasUsuarios.post('/admin/usuarios', requiereSesion, async (c) => {
  if (!soloAdmin(c.get('sesion').rol)) {
    return c.json({ error: 'rol_insuficiente', mensaje: 'Solo un administrador' }, 403);
  }

  const cuerpo = await leerJson(c, crearUsuarioSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return c.json(await crearUsuario(crearDb(c.env.DB), cuerpo.datos), 201);
  } catch (error) {
    return responderError(c, error);
  }
});

rutasUsuarios.patch('/admin/usuarios/:id', requiereSesion, async (c) => {
  const sesion = c.get('sesion');
  if (!soloAdmin(sesion.rol)) {
    return c.json({ error: 'rol_insuficiente', mensaje: 'Solo un administrador' }, 403);
  }

  const cuerpo = await leerJson(c, actualizarUsuarioSchema);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const db = crearDb(c.env.DB);
  const id = c.req.param('id');

  // No dejar que el ultimo administrador se saque a si mismo: el sistema
  // quedaria sin nadie que pueda administrarlo y habria que tocar la base a
  // mano para recuperarlo.
  const seEstaDegradando =
    id === sesion.usuarioId &&
    ((cuerpo.datos.rol !== undefined && cuerpo.datos.rol !== 'admin') ||
      cuerpo.datos.activo === false);

  if (seEstaDegradando && (await adminsActivos(db)) <= 1) {
    return c.json(
      {
        error: 'ultimo_admin',
        mensaje:
          'Sos el unico administrador activo. Da de alta a otro antes de sacarte el rol o desactivarte.',
      },
      422,
    );
  }

  try {
    return c.json(await actualizarUsuario(db, id, cuerpo.datos));
  } catch (error) {
    return responderError(c, error);
  }
});
