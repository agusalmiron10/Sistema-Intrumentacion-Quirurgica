import { useCallback, useEffect, useRef, useState } from 'react';

import { CamaraDiferida } from '../componentes/CamaraDiferida';
import { EntradaManual } from '../componentes/EntradaManual';
import { IndicadorSync } from '../componentes/IndicadorSync';
import { aplicarOptimista, legible, resolver, sincronizarCatalogo, validarLocalmente } from '../lib/cajas';
import { contarPendientes, encolar, sincronizar } from '../lib/cola';
import { leerMeta } from '../lib/almacen';
import { OPERACIONES, type Operacion } from '../lib/operaciones';
import { pedir } from '../lib/api';
import type { UsuarioSesion } from '../lib/sesion';
import { sonarError, sonarOk, sonarRepetido } from '../lib/sonido';

interface Props {
  usuario: UsuarioSesion;
  conflictos: number;
  onVerConflictos: () => void;
  onConflictosCambiaron: () => void;
  onSesionVencida: () => void;
}

interface Escaneado {
  clave: string;
  codigo: string;
  nombre: string;
  resultado: 'encolado' | 'rechazado' | 'repetido';
  detalle?: string;
}

interface CicloActivo {
  id: string;
  numeroLote: string;
  metodo: string;
  equipoNombre?: string;
}

interface CirugiaActiva {
  id: string;
  pacienteRef: string;
  procedimientoNombre?: string;
  cirujanoNombre?: string;
  programadaPara: string;
  quirofano: string | null;
}

const SEGUNDOS_ENTRE_SYNC = 30;

const METODOS_ES: Record<string, string> = {
  vapor: 'Vapor',
  oxido_etileno: 'Óxido de etileno',
  plasma: 'Plasma',
  calor_seco: 'Calor seco',
};

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

export function Escaneo({
  usuario,
  conflictos,
  onVerConflictos,
  onConflictosCambiaron,
  onSesionVencida,
}: Props) {
  const [operacion, setOperacion] = useState<Operacion | null>(null);
  const [tanda, setTanda] = useState<Escaneado[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Selector de ciclo
  const [ciclosActivos, setCiclosActivos] = useState<CicloActivo[]>([]);
  const [cargandoCiclos, setCargandoCiclos] = useState(false);
  const [cicloId, setCicloId] = useState<string | null>(null);

  // Selector de cirugía
  const [cirugias, setCirugias] = useState<CirugiaActiva[]>([]);
  const [cargandoCirugias, setCargandoCirugias] = useState(false);
  const [cirugiaId, setCirugiaId] = useState<string | null>(null);

  // La operacion se lee desde el callback del escaneo, que es estable para no
  // reiniciar la camara. Por eso vive tambien en un ref.
  const operacionActual = useRef<Operacion | null>(null);
  operacionActual.current = operacion;
  const cicloIdRef = useRef<string | null>(null);
  cicloIdRef.current = cicloId;
  const cirugiaIdRef = useRef<string | null>(null);
  cirugiaIdRef.current = cirugiaId;
  const [observacion, setObservacion] = useState('');
  const observacionRef = useRef('');
  observacionRef.current = observacion;
  const yaEnTanda = useRef(new Set<string>());

  const refrescarPendientes = useCallback(async () => {
    setPendientes(await contarPendientes());
  }, []);

  const sincronizarAhora = useCallback(async () => {
    if (!navigator.onLine) return;
    setSincronizando(true);
    try {
      const resultado = await sincronizar(usuario.id);
      if (resultado.estado === 'sesion_vencida') {
        onSesionVencida();
        return;
      }
      if (resultado.estado === 'ok' && resultado.conflictos > 0) {
        setAviso(
          `${resultado.conflictos} ${resultado.conflictos === 1 ? 'escaneo fue rechazado' : 'escaneos fueron rechazados'} por el servidor.`,
        );
        onConflictosCambiaron();
      }
    } catch {
      setAviso('No se pudo sincronizar. Los escaneos siguen guardados.');
    } finally {
      setSincronizando(false);
      await refrescarPendientes();
    }
  }, [usuario.id, onConflictosCambiaron, onSesionVencida, refrescarPendientes]);

  useEffect(() => {
    void refrescarPendientes();
    void sincronizarCatalogo().catch(() => undefined);
    void sincronizarAhora();

    const alVolver = (): void => {
      setEnLinea(true);
      void sincronizarCatalogo().catch(() => undefined);
      void sincronizarAhora();
    };
    const alCortarse = (): void => setEnLinea(false);

    window.addEventListener('online', alVolver);
    window.addEventListener('offline', alCortarse);
    const reloj = setInterval(() => void sincronizarAhora(), SEGUNDOS_ENTRE_SYNC * 1000);

    return () => {
      window.removeEventListener('online', alVolver);
      window.removeEventListener('offline', alCortarse);
      clearInterval(reloj);
    };
  }, [sincronizarAhora, refrescarPendientes]);

  /** Carga los ciclos filtrados por estado segun la operacion. */
  const cargarCiclos = useCallback(
    async (estadoFiltro: 'en_proceso' | 'finalizado') => {
      setCargandoCiclos(true);
      setCiclosActivos([]);
      try {
        const lista = await pedir<
          { id: string; numeroLote: string; metodo: string; estado: string }[]
        >(`/api/ciclos?limite=50`);
        const filtrados = lista.filter((c) => c.estado === estadoFiltro);
        setCiclosActivos(
          filtrados.map((c) => ({
            id: c.id,
            numeroLote: c.numeroLote,
            metodo: c.metodo,
          })),
        );
      } catch {
        const cacheados = (await leerMeta<{ id: string; numeroLote: string; metodo: string; estado: string }[]>('ciclosActivos')) || [];
        const filtrados = cacheados.filter((c) => c.estado === estadoFiltro);
        setCiclosActivos(
          filtrados.map((c) => ({
            id: c.id,
            numeroLote: c.numeroLote,
            metodo: c.metodo,
          })),
        );
      } finally {
        setCargandoCiclos(false);
      }
    },
    [],
  );

  /** Carga las cirugías programadas o preparadas para el selector de asignación. */
  const cargarCirugias = useCallback(async () => {
    setCargandoCirugias(true);
    setCirugias([]);
    try {
      const [programadas, preparadas] = await Promise.all([
        pedir<CirugiaActiva[]>('/api/cirugias?estado=programada&limite=100'),
        pedir<CirugiaActiva[]>('/api/cirugias?estado=preparada&limite=100'),
      ]);
      setCirugias([...programadas, ...preparadas]);
    } catch {
      const cacheadas = (await leerMeta<CirugiaActiva[]>('cirugias')) || [];
      setCirugias(cacheadas);
    } finally {
      setCargandoCirugias(false);
    }
  }, []);

  const procesar = useCallback(
    async (ref: string): Promise<void> => {
      const op = operacionActual.current;
      if (!op) return;

      const agregar = (item: Escaneado): void => setTanda((actual) => [item, ...actual]);
      const clave = `${ref}-${Date.now()}`;

      const resolucion = await resolver(ref);
      if (!resolucion.ok) {
        sonarError();
        agregar({
          clave,
          codigo: ref,
          nombre: '',
          resultado: 'rechazado',
          detalle:
            resolucion.motivo === 'desconocida_sin_red'
              ? 'Esta caja no esta en el catalogo de este dispositivo. Hace falta conectarse para actualizarlo.'
              : 'No existe ninguna caja con ese codigo.',
        });
        return;
      }

      const caja = resolucion.caja;

      if (yaEnTanda.current.has(caja.id)) {
        sonarRepetido();
        agregar({
          clave,
          codigo: caja.codigo,
          nombre: caja.nombre,
          resultado: 'repetido',
          detalle: 'Ya la habias escaneado en esta tanda.',
        });
        return;
      }

      const ocurridoEn = new Date().toISOString();
      const validacion = validarLocalmente(caja, op.hasta, ocurridoEn);
      if (!validacion.ok) {
        sonarError();
        agregar({
          clave,
          codigo: caja.codigo,
          nombre: caja.nombre,
          resultado: 'rechazado',
          detalle: validacion.mensaje,
        });
        return;
      }

      await encolar({
        // El id lo genera el cliente antes de tocar la red: si el envio se
        // corta y se reintenta, el servidor reconoce el mismo evento y no lo
        // duplica.
        id: crypto.randomUUID(),
        cajaRef: caja.id,
        cajaId: caja.id,
        cajaCodigo: caja.codigo,
        usuarioId: usuario.id,
        estadoDesde: caja.estado,
        estadoHasta: op.hasta,
        ocurridoEn,
        ...(cicloIdRef.current ? { cicloId: cicloIdRef.current } : {}),
        ...(cirugiaIdRef.current ? { cirugiaId: cirugiaIdRef.current } : {}),
        ...(observacionRef.current.trim() ? { observacion: observacionRef.current.trim() } : {}),
      });
      await aplicarOptimista(caja.id, op.hasta);

      yaEnTanda.current.add(caja.id);
      sonarOk();
      agregar({
        clave,
        codigo: caja.codigo,
        nombre: caja.nombre,
        resultado: 'encolado',
        detalle: `${legible(caja.estado)} → ${legible(op.hasta)}`,
      });

      await refrescarPendientes();
      void sincronizarAhora();
    },
    [usuario.id, refrescarPendientes, sincronizarAhora],
  );

  const alLeer = useCallback((ref: string) => void procesar(ref), [procesar]);

  const elegirOperacion = useCallback(
    (op: Operacion) => {
      yaEnTanda.current = new Set();
      setTanda([]);
      setAviso(null);
      setObservacion('');
      setCicloId(null);
      setCiclosActivos([]);
      setCirugiaId(null);
      setCirugias([]);
      setOperacion(op);

      if (op.necesitaCiclo) {
        const estadoFiltro = op.hasta === 'en_esterilizacion' ? 'en_proceso' : 'finalizado';
        void cargarCiclos(estadoFiltro);
      }
      if (op.necesitaCirugia) void cargarCirugias();
    },
    [cargarCiclos, cargarCirugias],
  );

  /* ── Sin operacion elegida: seleccion de tarea ── */
  if (!operacion) {
    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <p className="sutil">Hola, {usuario.nombre}</p>
            <h1 className="titulo">¿Qué estás haciendo?</h1>
          </div>
        </header>

        <IndicadorSync
          pendientes={pendientes}
          conflictos={conflictos}
          enLinea={enLinea}
          sincronizando={sincronizando}
          onSincronizar={() => void sincronizarAhora()}
          onVerConflictos={onVerConflictos}
        />

        <ul className="operaciones">
          {OPERACIONES.map((op) => (
            <li key={op.id}>
              <button
                type="button"
                className="operacion"
                onClick={() => elegirOperacion(op)}
              >
                <span className="operacion__etiqueta">{op.etiqueta}</span>
                <span className="operacion__descripcion">{op.descripcion}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  /* ── Operacion que necesita ciclo: selector previo al escaneo ── */
  if (operacion.necesitaCiclo && cicloId === null) {
    const estadoFiltro = operacion.hasta === 'en_esterilizacion' ? 'en_proceso' : 'finalizado';

    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <p className="sutil">{usuario.nombre}</p>
            <h1 className="titulo titulo--chico">{operacion.etiqueta}</h1>
          </div>
          <button type="button" className="boton boton--texto" onClick={() => setOperacion(null)}>
            Cambiar
          </button>
        </header>

        <section className="tarjeta">
          <h2 className="tarjeta__titulo">
            {operacion.hasta === 'en_esterilizacion'
              ? 'Seleccioná el ciclo al que vas a cargar las cajas'
              : 'Seleccioná el ciclo del que estás retirando las cajas'}
          </h2>
          <p className="sutil" style={{ marginBottom: '0.75rem' }}>
            El ciclo queda registrado junto a cada escaneo para la trazabilidad.
          </p>

          {cargandoCiclos && <p className="sutil">Cargando ciclos activos...</p>}

          {!cargandoCiclos && ciclosActivos.length === 0 && (
            <div className="aviso aviso--atencion">
              <strong>Sin ciclos disponibles</strong>
              <p style={{ margin: '0.25rem 0 0' }}>
                {enLinea
                  ? `No hay ciclos ${estadoFiltro === 'en_proceso' ? 'en proceso' : 'finalizados'} en este momento. Creá uno desde la pantalla de Esterilización.`
                  : 'Sin conexión: no se pueden cargar los ciclos. Conectate a la red e intentá de nuevo.'}
              </p>
            </div>
          )}

          {!cargandoCiclos && ciclosActivos.length > 0 && (
            <>
              <ul className="lista-selector">
                {ciclosActivos.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`selector-item ${c.id === (cicloId ?? ciclosActivos[0]?.id) ? 'selector-item--activo' : ''}`}
                      onClick={() => setCicloId(c.id)}
                    >
                      <span className="selector-item__principal">Lote {c.numeroLote}</span>
                      <span className="selector-item__secundario">
                        {METODOS_ES[c.metodo] ?? c.metodo}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="boton boton--primario"
                style={{ marginTop: '1rem' }}
                onClick={() => setCicloId((prev) => prev ?? ciclosActivos[0]?.id ?? null)}
              >
                Continuar con este ciclo →
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  /* ── Operacion que necesita cirugía: selector previo al escaneo ── */
  if (operacion.necesitaCirugia && cirugiaId === null) {
    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <p className="sutil">{usuario.nombre}</p>
            <h1 className="titulo titulo--chico">{operacion.etiqueta}</h1>
          </div>
          <button type="button" className="boton boton--texto" onClick={() => setOperacion(null)}>
            Cambiar
          </button>
        </header>

        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Seleccioná la cirugía</h2>
          <p className="sutil" style={{ marginBottom: '0.75rem' }}>
            La caja queda reservada para esta cirugía.
          </p>

          {cargandoCirugias && <p className="sutil">Cargando cirugías...</p>}

          {!cargandoCirugias && cirugias.length === 0 && (
            <div className="aviso aviso--atencion">
              <strong>Sin cirugías disponibles</strong>
              <p style={{ margin: '0.25rem 0 0' }}>
                {enLinea
                  ? 'No hay cirugías programadas ni preparadas. Creá una desde la pantalla de Cirugías.'
                  : 'Sin conexión: no se pueden cargar las cirugías. Conectate e intentá de nuevo.'}
              </p>
            </div>
          )}

          {!cargandoCirugias && cirugias.length > 0 && (
            <>
              <ul className="lista-selector">
                {cirugias.map((c) => {
                  const seleccionada = c.id === (cirugiaId ?? cirugias[0]?.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`selector-item ${seleccionada ? 'selector-item--activo' : ''}`}
                        onClick={() => setCirugiaId(c.id)}
                      >
                        <span className="selector-item__principal">Pac. {c.pacienteRef}</span>
                        <span className="selector-item__secundario">
                          {fechaCorta(c.programadaPara)}
                          {c.quirofano ? ` · Q${c.quirofano}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                className="boton boton--primario"
                style={{ marginTop: '1rem' }}
                onClick={() => {
                  const id = cirugiaId ?? cirugias[0]?.id ?? null;
                  setCirugiaId(id);
                }}
              >
                Continuar con esta cirugía →
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  /* ── Escaneo activo ── */
  const encolados = tanda.filter((t) => t.resultado === 'encolado').length;

  // Contexto visible (ciclo o cirugía seleccionada)
  const cicloSeleccionado = cicloId ? ciclosActivos.find((c) => c.id === cicloId) : null;
  const cirugiaSeleccionada = cirugiaId ? cirugias.find((c) => c.id === cirugiaId) : null;

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <p className="sutil">{usuario.nombre}</p>
          <h1 className="titulo titulo--chico">{operacion.etiqueta}</h1>
        </div>
        <button type="button" className="boton boton--texto" onClick={() => setOperacion(null)}>
          Cambiar
        </button>
      </header>

      {/* Contexto del ciclo o cirugía seleccionada */}
      {cicloSeleccionado && (
        <div className="contexto-escaneo">
          <span className="contexto-escaneo__icono">♻️</span>
          <span className="contexto-escaneo__texto">
            Lote <strong>{cicloSeleccionado.numeroLote}</strong>
            {' · '}{METODOS_ES[cicloSeleccionado.metodo] ?? cicloSeleccionado.metodo}
          </span>
          <button
            type="button"
            className="boton boton--texto boton--chico"
            onClick={() => {
              setCicloId(null);
              const estadoFiltro = operacion.hasta === 'en_esterilizacion' ? 'en_proceso' : 'finalizado';
              void cargarCiclos(estadoFiltro);
            }}
          >
            Cambiar
          </button>
        </div>
      )}
      {cirugiaSeleccionada && (
        <div className="contexto-escaneo">
          <span className="contexto-escaneo__icono">🏥</span>
          <span className="contexto-escaneo__texto">
            Pac. <strong>{cirugiaSeleccionada.pacienteRef}</strong>
            {' · '}{fechaCorta(cirugiaSeleccionada.programadaPara)}
          </span>
          <button
            type="button"
            className="boton boton--texto boton--chico"
            onClick={() => {
              setCirugiaId(null);
              void cargarCirugias();
            }}
          >
            Cambiar
          </button>
        </div>
      )}

      <IndicadorSync
        pendientes={pendientes}
        conflictos={conflictos}
        enLinea={enLinea}
        sincronizando={sincronizando}
        onSincronizar={() => void sincronizarAhora()}
        onVerConflictos={onVerConflictos}
      />

      {aviso && (
        <p className="aviso aviso--atencion">
          {aviso}{' '}
          <button type="button" className="boton boton--texto" onClick={() => setAviso(null)}>
            Entendido
          </button>
        </p>
      )}

      <div className="observacion-escaneo">
        <input
          type="text"
          className="observacion-escaneo__input"
          placeholder="Observación opcional (ej: traba dañada)..."
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
          maxLength={100}
        />
        {observacion && (
          <button
            type="button"
            className="boton boton--texto"
            onClick={() => setObservacion('')}
            title="Borrar observación"
          >
            ✕
          </button>
        )}
      </div>

      {/* El campo manual va primero en el DOM: si el lector tarda o la camara
          esta bloqueada, la usuaria igual puede trabajar sin esperar nada. */}
      <EntradaManual onIngreso={alLeer} />
      <CamaraDiferida activa onLectura={alLeer} />

      <section className="tanda">
        <h2 className="tanda__titulo">
          {encolados} {encolados === 1 ? 'caja registrada' : 'cajas registradas'}
        </h2>
        <ul className="tanda__lista">
          {tanda.map((item) => (
            <li key={item.clave} className={`escaneo escaneo--${item.resultado}`}>
              <div className="escaneo__cabecera">
                <strong className="escaneo__codigo">{item.codigo}</strong>
                <span className="escaneo__marca">
                  {item.resultado === 'encolado' ? '✓' : item.resultado === 'repetido' ? '=' : '✕'}
                </span>
              </div>
              {item.nombre && <p className="escaneo__nombre">{item.nombre}</p>}
              {item.detalle && <p className="escaneo__detalle">{item.detalle}</p>}
            </li>
          ))}
        </ul>
        {tanda.length === 0 && (
          <p className="sutil">Pasa las cajas por la camara o escribi el codigo.</p>
        )}
      </section>
    </main>
  );
}
