import { abrirAlmacen, type ConflictoLocal, type EventoEnCola } from './almacen';
import { ErrorApi, pedir, SinRed } from './api';
import { confirmarEstado } from './cajas';

/**
 * Cola de escaneos sin sincronizar.
 *
 * La regla: un escaneo encolado es trabajo que la usuaria ya hizo. Nunca se
 * descarta en silencio. O se aplica, o queda como conflicto visible.
 */

export interface ResultadoServidor {
  id: string;
  cajaRef: string;
  cajaId?: string;
  estadoActual?: string;
  estado: 'aplicado' | 'duplicado' | 'conflicto';
  codigo?: string;
  mensaje?: string;
}

export async function encolar(evento: EventoEnCola): Promise<void> {
  (await abrirAlmacen()).put('cola', evento);
}

export async function pendientes(): Promise<EventoEnCola[]> {
  return (await abrirAlmacen()).getAllFromIndex('cola', 'ocurridoEn');
}

export async function contarPendientes(): Promise<number> {
  return (await abrirAlmacen()).count('cola');
}

export async function conflictos(): Promise<ConflictoLocal[]> {
  const todos = await (await abrirAlmacen()).getAllFromIndex('conflictos', 'detectadoEn');
  return todos.reverse();
}

export async function descartarConflicto(id: string): Promise<void> {
  (await abrirAlmacen()).delete('conflictos', id);
}

export type ResultadoSync =
  | { estado: 'sin_pendientes' }
  | { estado: 'sin_red' }
  | { estado: 'sesion_vencida' }
  | { estado: 'ok'; aplicados: number; duplicados: number; conflictos: number; ajenos: number };

/**
 * Manda la cola al servidor y procesa el resultado evento por evento.
 *
 * Solo se envian los escaneos del usuario que tiene la sesion abierta. Si la
 * tablet cambio de mano con la cola sin vaciar, los de la persona anterior
 * esperan a que vuelva: un escaneo tiene que quedar a nombre de quien lo hizo.
 */
export async function sincronizar(usuarioId: string): Promise<ResultadoSync> {
  const todos = await pendientes();
  const mios = todos.filter((e) => e.usuarioId === usuarioId);
  const ajenos = todos.length - mios.length;

  if (mios.length === 0) {
    return ajenos > 0
      ? { estado: 'ok', aplicados: 0, duplicados: 0, conflictos: 0, ajenos }
      : { estado: 'sin_pendientes' };
  }

  let respuesta: { resultados: ResultadoServidor[] };
  try {
    respuesta = await pedir<{ resultados: ResultadoServidor[] }>('/api/eventos', {
      metodo: 'POST',
      cuerpo: {
        eventos: mios.map((e) => ({
          id: e.id,
          cajaRef: e.cajaRef,
          usuarioId: e.usuarioId,
          estadoDesde: e.estadoDesde,
          estadoHasta: e.estadoHasta,
          ocurridoEn: e.ocurridoEn,
          ...(e.cicloId ? { cicloId: e.cicloId } : {}),
          ...(e.cirugiaId ? { cirugiaId: e.cirugiaId } : {}),
          observacion: e.observacion ?? null,
        })),
      },
    });
  } catch (error) {
    if (error instanceof SinRed) return { estado: 'sin_red' };
    if (error instanceof ErrorApi && error.estado === 401) return { estado: 'sesion_vencida' };
    throw error;
  }

  const db = await abrirAlmacen();
  const porId = new Map(mios.map((e) => [e.id, e]));
  let aplicados = 0;
  let duplicados = 0;
  let enConflicto = 0;

  for (const resultado of respuesta.resultados) {
    const evento = porId.get(resultado.id);
    if (!evento) continue;

    if (resultado.estado === 'conflicto') {
      // El evento sale de la cola pero no desaparece: pasa a la lista de
      // conflictos para que alguien lo mire y decida.
      if (resultado.codigo === 'usuario_distinto') continue;

      enConflicto++;
      await db.put('conflictos', {
        id: resultado.id,
        cajaRef: evento.cajaRef,
        cajaCodigo: evento.cajaCodigo,
        estadoIntentado: evento.estadoHasta,
        ...(resultado.estadoActual !== undefined ? { estadoActual: resultado.estadoActual } : {}),
        codigo: resultado.codigo ?? 'desconocido',
        mensaje: resultado.mensaje ?? 'El servidor rechazo el escaneo',
        ocurridoEn: evento.ocurridoEn,
        detectadoEn: new Date().toISOString(),
      });
    } else if (resultado.estado === 'aplicado') {
      aplicados++;
    } else {
      duplicados++;
    }

    await db.delete('cola', resultado.id);
    if (resultado.cajaId && resultado.estadoActual) {
      await confirmarEstado(resultado.cajaId, resultado.estadoActual);
    }
  }

  return { estado: 'ok', aplicados, duplicados, conflictos: enConflicto, ajenos };
}
