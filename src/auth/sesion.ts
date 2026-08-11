import type { RolUsuario } from '../dominio/estados';

/**
 * Token de sesion firmado con HMAC-SHA256.
 *
 * Sin tabla de sesiones a proposito: la PWA trabaja offline y no puede
 * consultar la validez del token en cada accion. El token se valida solo, con
 * su firma y su vencimiento.
 *
 * La contracara es que no hay revocacion inmediata. Por eso la vida util es
 * corta (un turno) y las acciones destructivas siguen exigiendo rol.
 */

const VIDA_UTIL_SEGUNDOS = 14 * 60 * 60; // un turno largo, con margen

export interface Sesion {
  usuarioId: string;
  rol: RolUsuario;
  /** Epoch en segundos. */
  exp: number;
}

function aBase64Url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function desdeBase64Url(texto: string): Uint8Array {
  const relleno = texto.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(relleno.padEnd(Math.ceil(relleno.length / 4) * 4, '='));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function clave(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function firmarSesion(
  secreto: string,
  usuarioId: string,
  rol: RolUsuario,
  ahora = Date.now(),
): Promise<string> {
  const sesion: Sesion = {
    usuarioId,
    rol,
    exp: Math.floor(ahora / 1000) + VIDA_UTIL_SEGUNDOS,
  };
  const carga = aBase64Url(new TextEncoder().encode(JSON.stringify(sesion)));
  const firma = await crypto.subtle.sign('HMAC', await clave(secreto), new TextEncoder().encode(carga));
  return `${carga}.${aBase64Url(new Uint8Array(firma))}`;
}

/** Devuelve null ante cualquier problema: firma mala, formato roto o vencida. */
export async function verificarSesion(
  secreto: string,
  token: string,
  ahora = Date.now(),
): Promise<Sesion | null> {
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [carga, firma] = partes as [string, string];

  let valida: boolean;
  try {
    valida = await crypto.subtle.verify(
      'HMAC',
      await clave(secreto),
      desdeBase64Url(firma) as BufferSource,
      new TextEncoder().encode(carga),
    );
  } catch {
    return null;
  }
  if (!valida) return null;

  try {
    const sesion = JSON.parse(new TextDecoder().decode(desdeBase64Url(carga))) as Sesion;
    if (typeof sesion.exp !== 'number' || sesion.exp * 1000 < ahora) return null;
    if (typeof sesion.usuarioId !== 'string' || !sesion.usuarioId) return null;
    return sesion;
  } catch {
    return null;
  }
}
