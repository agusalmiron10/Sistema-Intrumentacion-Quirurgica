import { SELF, env } from 'cloudflare:test';

import { hashPin } from '../src/auth/pin';

/** Helpers compartidos por los tests de API de las fases 4 a 7. */

export const BASE = 'https://test.local';
export const PIN_PRUEBA = '8080';

/** Los eventos con fecha futura los rechaza el servidor por reloj desfasado. */
export const hace = (minutos: number): string =>
  new Date(Date.now() - minutos * 60_000).toISOString();

export interface Respuesta<T> {
  estado: number;
  cuerpo: T;
}

export async function api<T = unknown>(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; token?: string } = {},
): Promise<Respuesta<T>> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opciones.token) cabeceras['Authorization'] = `Bearer ${opciones.token}`;

  const res = await SELF.fetch(`${BASE}${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers: cabeceras,
    ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
  });
  const texto = await res.text();
  return { estado: res.status, cuerpo: (texto ? JSON.parse(texto) : null) as T };
}

export async function crearUsuario(id: string, rol: string): Promise<void> {
  await env.DB.prepare(
    `insert or replace into usuario (id, nombre, email, pin_hash, rol, intentos_fallidos, bloqueado_hasta)
     values (?, ?, ?, ?, ?, 0, null)`,
  )
    .bind(id, `Usuaria ${id}`, `${id}@hospital.local`, await hashPin(PIN_PRUEBA), rol)
    .run();
}

export async function ingresar(usuarioId: string): Promise<string> {
  const res = await api<{ token: string }>('/api/sesion', {
    metodo: 'POST',
    cuerpo: { usuarioId, pin: PIN_PRUEBA },
  });
  return res.cuerpo.token;
}

/** Mueve una caja por la maquina de estados con eventos reales. */
export async function moverCaja(
  cajaRef: string,
  usuarioId: string,
  token: string,
  pasos: readonly [string, string][],
  desdeMinutos = 240,
): Promise<void> {
  await api('/api/eventos', {
    metodo: 'POST',
    token,
    cuerpo: {
      eventos: pasos.map(([desde, hasta], i) => ({
        id: crypto.randomUUID(),
        cajaRef,
        usuarioId,
        estadoDesde: desde,
        estadoHasta: hasta,
        ocurridoEn: hace(desdeMinutos - i),
      })),
    },
  });
}
