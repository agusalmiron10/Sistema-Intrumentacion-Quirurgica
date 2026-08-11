import { and, asc, eq } from 'drizzle-orm';

import { verificarPin } from '../auth/pin';
import type { Db } from '../db';
import { schema } from '../db';
import type { RolUsuario } from '../dominio/estados';

/**
 * Politica de bloqueo.
 *
 * Un PIN de 4 a 6 digitos tiene entre 10.000 y 1.000.000 de combinaciones: es
 * chico a proposito, porque se tipea con guantes y apurado. Lo que hace que
 * eso sea aceptable no es el hash, es esto: despues de unos pocos intentos
 * fallidos el usuario queda bloqueado un rato y la fuerza bruta deja de ser
 * viable.
 */
const INTENTOS_ANTES_DE_BLOQUEAR = 5;
const MINUTOS_DE_BLOQUEO = 5;

export interface UsuarioParaElegir {
  id: string;
  nombre: string;
  rol: RolUsuario;
}

/**
 * Usuarios que se muestran en la pantalla de ingreso.
 *
 * Devuelve solo lo indispensable para elegir: ni el email ni, obviamente, el
 * hash del PIN. La eleccion del usuario es explicita justamente para no tener
 * que buscar "que usuario tiene este PIN".
 */
export async function listarParaElegir(db: Db): Promise<UsuarioParaElegir[]> {
  const filas = await db
    .select({ id: schema.usuario.id, nombre: schema.usuario.nombre, rol: schema.usuario.rol })
    .from(schema.usuario)
    .where(eq(schema.usuario.activo, 1))
    .orderBy(asc(schema.usuario.nombre));

  return filas as UsuarioParaElegir[];
}

export type ResultadoIngreso =
  | { ok: true; usuarioId: string; nombre: string; rol: RolUsuario }
  | { ok: false; motivo: 'credenciales'; intentosRestantes: number }
  | { ok: false; motivo: 'bloqueado'; bloqueadoHasta: string };

export async function autenticar(
  db: Db,
  usuarioId: string,
  pin: string,
  ahora = new Date(),
): Promise<ResultadoIngreso> {
  const usuario = await db.query.usuario.findFirst({
    where: and(eq(schema.usuario.id, usuarioId), eq(schema.usuario.activo, 1)),
  });

  // Usuario inexistente y PIN equivocado dan la misma respuesta: la lista de
  // usuarios ya es publica, pero no hay motivo para confirmar cual existe.
  if (!usuario) {
    return { ok: false, motivo: 'credenciales', intentosRestantes: INTENTOS_ANTES_DE_BLOQUEAR };
  }

  if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > ahora.toISOString()) {
    return { ok: false, motivo: 'bloqueado', bloqueadoHasta: usuario.bloqueadoHasta };
  }

  if (await verificarPin(pin, usuario.pinHash)) {
    await db
      .update(schema.usuario)
      .set({ intentosFallidos: 0, bloqueadoHasta: null })
      .where(eq(schema.usuario.id, usuario.id));
    return {
      ok: true,
      usuarioId: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol as RolUsuario,
    };
  }

  const fallidos = usuario.intentosFallidos + 1;
  if (fallidos >= INTENTOS_ANTES_DE_BLOQUEAR) {
    const hasta = new Date(ahora.getTime() + MINUTOS_DE_BLOQUEO * 60_000).toISOString();
    await db
      .update(schema.usuario)
      .set({ intentosFallidos: 0, bloqueadoHasta: hasta })
      .where(eq(schema.usuario.id, usuario.id));
    return { ok: false, motivo: 'bloqueado', bloqueadoHasta: hasta };
  }

  await db
    .update(schema.usuario)
    .set({ intentosFallidos: fallidos })
    .where(eq(schema.usuario.id, usuario.id));
  return {
    ok: false,
    motivo: 'credenciales',
    intentosRestantes: INTENTOS_ANTES_DE_BLOQUEAR - fallidos,
  };
}
