import { and, asc, eq, sql } from 'drizzle-orm';

import { ErrorDeNegocio } from '../api/respuestas';
import { hashPin, verificarPin } from '../auth/pin';
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

// ---------------------------------------------------------------------------
// Configuracion inicial y administracion de usuarios
// ---------------------------------------------------------------------------

export async function hayUsuarios(db: Db): Promise<boolean> {
  const [fila] = await db.select({ n: sql<number>`count(*)` }).from(schema.usuario);
  return (fila?.n ?? 0) > 0;
}

/**
 * Crea el primer administrador.
 *
 * Sin esto el sistema queda trabado: no se puede entrar sin usuario y no se
 * puede crear un usuario sin entrar. Es el clasico problema del huevo y la
 * gallina de cualquier sistema con login.
 *
 * La unica manera de que esto no sea un agujero es que funcione EXACTAMENTE
 * una vez. El INSERT ... SELECT ... WHERE NOT EXISTS lo resuelve en una sola
 * sentencia: si dos pedidos llegan al mismo tiempo, SQLite ejecuta uno y el
 * otro no inserta nada. Chequear primero y despues insertar dejaria una
 * ventana entre las dos consultas.
 */
export async function configurarPrimerAdmin(
  db: Db,
  datos: { nombre: string; email: string; pin: string },
): Promise<{ ok: true; usuarioId: string } | { ok: false; motivo: 'ya_configurado' }> {
  const id = crypto.randomUUID();
  const hash = await hashPin(datos.pin);

  const resultado = await db.run(sql`
    insert into usuario (id, nombre, email, pin_hash, rol, intentos_fallidos, activo)
    select ${id}, ${datos.nombre}, ${datos.email}, ${hash}, 'admin', 0, 1
    where not exists (select 1 from usuario)
  `);

  const insertadas = resultado.meta?.changes ?? 0;
  if (insertadas === 0) return { ok: false, motivo: 'ya_configurado' };

  return { ok: true, usuarioId: id };
}

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: number;
  bloqueadoHasta: string | null;
  creadoEn: string;
}

/** Vista completa para la pantalla de administracion. Nunca incluye el hash. */
export async function listarTodos(db: Db): Promise<UsuarioAdmin[]> {
  const filas = await db
    .select({
      id: schema.usuario.id,
      nombre: schema.usuario.nombre,
      email: schema.usuario.email,
      rol: schema.usuario.rol,
      activo: schema.usuario.activo,
      bloqueadoHasta: schema.usuario.bloqueadoHasta,
      creadoEn: schema.usuario.creadoEn,
    })
    .from(schema.usuario)
    .orderBy(asc(schema.usuario.nombre));

  return filas as UsuarioAdmin[];
}

export async function crearUsuario(
  db: Db,
  datos: { nombre: string; email: string; rol: RolUsuario; pin: string },
): Promise<UsuarioAdmin> {
  const id = crypto.randomUUID();
  await db.insert(schema.usuario).values({
    id,
    nombre: datos.nombre,
    email: datos.email,
    rol: datos.rol,
    pinHash: await hashPin(datos.pin),
  });

  const creado = (await listarTodos(db)).find((u) => u.id === id);
  if (!creado) throw new ErrorDeNegocio('no_creado', 'El usuario no quedo creado');
  return creado;
}

export async function actualizarUsuario(
  db: Db,
  id: string,
  datos: {
    nombre?: string | undefined;
    email?: string | undefined;
    rol?: RolUsuario | undefined;
    activo?: boolean | undefined;
    pin?: string | undefined;
  },
): Promise<UsuarioAdmin> {
  const existente = await db.query.usuario.findFirst({ where: eq(schema.usuario.id, id) });
  if (!existente) throw new ErrorDeNegocio('usuario_inexistente', 'No existe ese usuario');

  const cambios: Partial<typeof schema.usuario.$inferInsert> = {};
  if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
  if (datos.email !== undefined) cambios.email = datos.email;
  if (datos.rol !== undefined) cambios.rol = datos.rol;
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (datos.pin !== undefined) {
    // Blanquear el PIN tambien libera el bloqueo: si alguien se olvido el PIN
    // y se bloqueo probando, no tiene sentido hacerlo esperar ademas.
    cambios.pinHash = await hashPin(datos.pin);
    cambios.intentosFallidos = 0;
    cambios.bloqueadoHasta = null;
  }

  await db.update(schema.usuario).set(cambios).where(eq(schema.usuario.id, id));

  const actualizado = (await listarTodos(db)).find((u) => u.id === id);
  if (!actualizado) throw new ErrorDeNegocio('usuario_inexistente', 'No existe ese usuario');
  return actualizado;
}

/**
 * Cuantos administradores activos quedan.
 *
 * Sirve para no permitir que el ultimo admin se desactive a si mismo o se
 * cambie de rol: eso dejaria el sistema sin nadie que pueda administrarlo, y
 * la unica salida seria tocar la base a mano.
 */
export async function adminsActivos(db: Db): Promise<number> {
  const [fila] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.usuario)
    .where(and(eq(schema.usuario.rol, 'admin'), eq(schema.usuario.activo, 1)));
  return fila?.n ?? 0;
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
