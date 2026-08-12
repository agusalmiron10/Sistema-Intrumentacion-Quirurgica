import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { EstadoCaja } from '../../../src/dominio/estados';

/**
 * Almacenamiento local de la PWA.
 *
 * Tres cosas viven en IndexedDB y no en memoria: la cola de escaneos sin
 * sincronizar, el catalogo de cajas (para poder validar y mostrar estados sin
 * señal) y los conflictos que el servidor rechazo.
 *
 * Un escaneo encolado es trabajo real que la usuaria ya hizo: no se puede
 * perder porque se recargue la pagina o se apague la tablet.
 */

export interface CajaLocal {
  id: string;
  codigo: string;
  nombre: string;
  servicio: string | null;
  estado: EstadoCaja;
  venceEl: string | null;
  /** 1 si la caja sigue habilitada. */
  activa: number;
  /** true mientras el evento que la movio no fue confirmado por el servidor. */
  optimista?: boolean;
}

export interface EventoEnCola {
  id: string;
  cajaRef: string;
  cajaId: string;
  cajaCodigo: string;
  usuarioId: string;
  estadoDesde: EstadoCaja;
  estadoHasta: EstadoCaja;
  ocurridoEn: string;
  cicloId?: string | null;
  cirugiaId?: string | null;
  observacion?: string | null;
}

export interface ConflictoLocal {
  id: string;
  cajaRef: string;
  cajaCodigo: string;
  estadoIntentado: EstadoCaja;
  estadoActual?: string;
  codigo: string;
  mensaje: string;
  ocurridoEn: string;
  detectadoEn: string;
}

interface Esquema extends DBSchema {
  cola: { key: string; value: EventoEnCola; indexes: { ocurridoEn: string } };
  cajas: { key: string; value: CajaLocal; indexes: { codigo: string } };
  conflictos: { key: string; value: ConflictoLocal; indexes: { detectadoEn: string } };
  meta: { key: string; value: unknown };
}

let promesa: Promise<IDBPDatabase<Esquema>> | null = null;

export function abrirAlmacen(): Promise<IDBPDatabase<Esquema>> {
  promesa ??= openDB<Esquema>('instrumentacion', 1, {
    upgrade(db) {
      const cola = db.createObjectStore('cola', { keyPath: 'id' });
      cola.createIndex('ocurridoEn', 'ocurridoEn');

      const cajas = db.createObjectStore('cajas', { keyPath: 'id' });
      cajas.createIndex('codigo', 'codigo', { unique: true });

      const conflictos = db.createObjectStore('conflictos', { keyPath: 'id' });
      conflictos.createIndex('detectadoEn', 'detectadoEn');

      db.createObjectStore('meta');
    },
  });
  return promesa;
}

export async function guardarMeta(clave: string, valor: unknown): Promise<void> {
  (await abrirAlmacen()).put('meta', valor, clave);
}

export async function leerMeta<T>(clave: string): Promise<T | undefined> {
  return (await abrirAlmacen()).get('meta', clave) as Promise<T | undefined>;
}
