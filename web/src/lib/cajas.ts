import { esTransicionValida, type EstadoCaja } from '../../../src/dominio/estados';
import { normalizarCodigo } from '../../../src/dominio/identificadores';
import { abrirAlmacen, guardarMeta, type CajaLocal } from './almacen';
import { hayRed, pedir, SinRed } from './api';

/**
 * Catalogo local de cajas.
 *
 * Sin esto no hay modo offline de verdad: para armar un evento hace falta
 * saber de que estado sale la caja, y eso no se puede adivinar. El catalogo se
 * baja cuando hay señal y queda disponible aunque despues no la haya.
 */

export async function sincronizarCatalogo(): Promise<number> {
  const cajas = await pedir<CajaLocal[]>('/api/cajas?limite=500');
  const db = await abrirAlmacen();

  const tx = db.transaction('cajas', 'readwrite');
  // Las cajas con un evento sin confirmar mantienen su estado optimista: lo
  // que vino del servidor todavia no incluye ese escaneo.
  const optimistas = new Set(
    (await db.getAll('cajas')).filter((c) => c.optimista).map((c) => c.id),
  );
  for (const caja of cajas) {
    if (!optimistas.has(caja.id)) await tx.store.put(caja);
  }
  await tx.done;

  await guardarMeta('catalogoActualizadoEn', new Date().toISOString());
  return cajas.length;
}

export async function buscarLocal(ref: string): Promise<CajaLocal | undefined> {
  const db = await abrirAlmacen();
  const porId = await db.get('cajas', ref);
  if (porId) return porId;
  return db.getFromIndex('cajas', 'codigo', normalizarCodigo(ref));
}

export async function guardarLocal(caja: CajaLocal): Promise<void> {
  (await abrirAlmacen()).put('cajas', caja);
}

export async function listarLocales(): Promise<CajaLocal[]> {
  return (await abrirAlmacen()).getAll('cajas');
}

export type Resolucion =
  | { ok: true; caja: CajaLocal }
  | { ok: false; motivo: 'desconocida_sin_red' | 'inexistente' };

/**
 * Encuentra la caja para un escaneo. Si no esta en el catalogo local y hay
 * señal, la busca; si no hay señal, avisa en vez de encolar un evento que no
 * se puede construir bien.
 */
export async function resolver(ref: string): Promise<Resolucion> {
  const local = await buscarLocal(ref);
  if (local) return { ok: true, caja: local };

  if (!hayRed()) return { ok: false, motivo: 'desconocida_sin_red' };

  try {
    const caja = await pedir<CajaLocal>(`/api/cajas/${encodeURIComponent(ref)}`);
    await guardarLocal(caja);
    return { ok: true, caja };
  } catch (error) {
    if (error instanceof SinRed) return { ok: false, motivo: 'desconocida_sin_red' };
    return { ok: false, motivo: 'inexistente' };
  }
}

export type Validacion = { ok: true } | { ok: false; mensaje: string };

/**
 * Misma maquina de estados que la base, para dar respuesta inmediata sin
 * esperar al servidor. El servidor sigue siendo la autoridad: esto es
 * comodidad, no seguridad.
 */
export function validarLocalmente(
  caja: CajaLocal,
  hasta: EstadoCaja,
  ocurridoEn: string,
): Validacion {
  if (caja.estado === hasta) {
    return { ok: false, mensaje: `${caja.codigo} ya esta en ese estado` };
  }

  if (!esTransicionValida(caja.estado, hasta)) {
    return {
      ok: false,
      mensaje: `${caja.codigo} esta en "${legible(caja.estado)}" y no puede pasar a "${legible(hasta)}"`,
    };
  }

  if (hasta === 'asignada') {
    if (caja.activa === 0) {
      return { ok: false, mensaje: `${caja.codigo} esta dada de baja` };
    }
    if (caja.venceEl && caja.venceEl < ocurridoEn) {
      return { ok: false, mensaje: `${caja.codigo} tiene la esterilidad vencida` };
    }
  }

  return { ok: true };
}

/** Adelanta el estado local para que se pueda encadenar el escaneo siguiente sin señal. */
export async function aplicarOptimista(cajaId: string, estado: EstadoCaja): Promise<void> {
  const db = await abrirAlmacen();
  const caja = await db.get('cajas', cajaId);
  if (!caja) return;
  await db.put('cajas', { ...caja, estado, optimista: true });
}

/** Fija el estado que confirmo el servidor y saca la marca de optimista. */
export async function confirmarEstado(cajaId: string, estado: string): Promise<void> {
  const db = await abrirAlmacen();
  const caja = await db.get('cajas', cajaId);
  if (!caja) return;
  const { optimista: _descartado, ...resto } = caja;
  await db.put('cajas', { ...resto, estado: estado as EstadoCaja });
}

export function legible(estado: string): string {
  return estado.replace(/_/g, ' ');
}
