export interface UsuarioSesion {
  id: string;
  nombre: string;
  rol: string;
}

interface SesionGuardada {
  token: string;
  usuario: UsuarioSesion;
}

const CLAVE = 'instrumentacion.sesion';

/**
 * La sesion vive en localStorage y no en una cookie porque tiene que
 * sobrevivir a que se cierre la app y se siga trabajando sin señal.
 *
 * Dura un turno largo a proposito: si venciera cada media hora, alguien sin
 * conexion en la central de esterilizacion quedaria sin poder ingresar. Si
 * igual vence estando offline, se puede seguir escaneando (los eventos van a
 * la cola) y se pide ingresar de nuevo recien al sincronizar.
 */
export function leerSesion(): SesionGuardada | null {
  const crudo = localStorage.getItem(CLAVE);
  if (!crudo) return null;
  try {
    const sesion = JSON.parse(crudo) as SesionGuardada;
    return sesion.token && sesion.usuario?.id ? sesion : null;
  } catch {
    return null;
  }
}

export function guardarSesion(sesion: SesionGuardada): void {
  localStorage.setItem(CLAVE, JSON.stringify(sesion));
}

export function borrarSesion(): void {
  localStorage.removeItem(CLAVE);
}
