import { useEffect, useState } from 'react';

import { ErrorApi, pedir } from '../lib/api';

interface Props {
  onVolver: () => void;
  rol: string;
}

interface Equipo {
  id: string;
  nombre: string;
}

interface Ciclo {
  id: string;
  numeroLote: string;
  equipoId: string;
  metodo: string;
  estado: string;
  iniciadoEn: string;
  finalizadoEn: string | null;
  liberadoEn: string | null;
  controlFisico: string | null;
  controlQuimico: string | null;
  controlBiologico: string | null;
  cajasCount?: number;
}

interface CicloDetalle extends Ciclo {
  cajas: { id: string; codigo: string; nombre: string }[];
}

const METODOS = [
  { valor: 'vapor', etiqueta: 'Vapor' },
  { valor: 'oxido_etileno', etiqueta: 'Óxido de etileno' },
  { valor: 'plasma', etiqueta: 'Plasma' },
  { valor: 'calor_seco', etiqueta: 'Calor seco' },
];

const ESTADOS_CICLO: Record<string, string> = {
  en_proceso: 'En proceso',
  finalizado: 'Finalizado (en cuarentena)',
  liberado: 'Liberado',
  rechazado: 'Rechazado (control biológico)',
};

const RESULTADOS_CONTROL = [
  { valor: 'conforme', etiqueta: '✓ Conforme' },
  { valor: 'no_conforme', etiqueta: '✕ No conforme' },
  { valor: 'pendiente', etiqueta: '⏳ Pendiente' },
];

function fechaLocal(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** Pantalla de ciclos de esterilización. */
export function Ciclos({ onVolver, rol }: Props) {
  const [ciclos, setCiclos] = useState<Ciclo[]>([]);
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<CicloDetalle | null>(null);

  // Formulario nuevo ciclo
  const [mostrarForm, setMostrarForm] = useState(false);
  const [numeroLote, setNumeroLote] = useState('');
  const [equipoId, setEquipoId] = useState('');
  const [metodo, setMetodo] = useState('vapor');
  const [cajaRefs, setCajaRefs] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Controles
  const [cicloControlando, setCicloControlando] = useState<string | null>(null);
  const [controlFisico, setControlFisico] = useState('conforme');
  const [controlQuimico, setControlQuimico] = useState('conforme');
  const [controlBiologico, setControlBiologico] = useState('pendiente');

  const esSupervisorOAdmin = rol === 'supervisor' || rol === 'admin';

  const recargar = async (): Promise<void> => {
    try {
      const [listaCiclos, listaEquipos] = await Promise.all([
        pedir<Ciclo[]>('/api/ciclos'),
        pedir<Equipo[]>('/api/ciclos/equipos'),
      ]);
      setCiclos(listaCiclos);
      setEquipos(listaEquipos);
      if (listaEquipos.length > 0 && !equipoId) setEquipoId(listaEquipos[0]!.id);
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void recargar();
  }, []);

  const crear = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      const refs = cajaRefs
        .split(/[\n,;]+/)
        .map((r) => r.trim())
        .filter(Boolean);
      if (refs.length === 0) {
        setError('Ingresá al menos una caja.');
        return;
      }
      await pedir('/api/ciclos', {
        metodo: 'POST',
        cuerpo: {
          numeroLote: numeroLote.trim(),
          equipoId,
          metodo,
          iniciadoEn: new Date().toISOString(),
          cajaRefs: refs,
        },
      });
      setExito(`Ciclo "${numeroLote.trim()}" creado.`);
      setNumeroLote('');
      setCajaRefs('');
      setMostrarForm(false);
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo crear el ciclo');
    } finally {
      setEnviando(false);
    }
  };

  const finalizar = async (id: string): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      await pedir(`/api/ciclos/${id}/finalizar`, {
        metodo: 'POST',
        cuerpo: { finalizadoEn: new Date().toISOString() },
      });
      setExito('Ciclo finalizado. Las cajas pasaron a cuarentena.');
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo finalizar');
    }
  };

  const cargarControles = async (id: string): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      const resultado = await pedir<{
        recall?: { cajasRetiradas: number; cirugiasAfectadas: number };
      }>(`/api/ciclos/${id}/controles`, {
        metodo: 'POST',
        cuerpo: {
          controlFisico,
          controlQuimico,
          controlBiologico: controlBiologico === 'pendiente' ? undefined : controlBiologico,
          ocurridoEn: new Date().toISOString(),
        },
      });
      if (resultado.recall) {
        setExito(
          `⚠️ RECALL: Control biológico no conforme. Se retiraron ${resultado.recall.cajasRetiradas} cajas. ${resultado.recall.cirugiasAfectadas} cirugías afectadas.`,
        );
      } else {
        setExito('Controles cargados correctamente.');
      }
      setCicloControlando(null);
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudieron cargar los controles');
    }
  };

  const liberar = async (id: string): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      await pedir(`/api/ciclos/${id}/liberar`, {
        metodo: 'POST',
        cuerpo: { liberadoEn: new Date().toISOString() },
      });
      setExito('Lote liberado. Las cajas volvieron al depósito estéril.');
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo liberar');
    }
  };

  const verDetalle = async (id: string): Promise<void> => {
    try {
      const d = await pedir<CicloDetalle>(`/api/ciclos/${id}`);
      setDetalle(d);
    } catch {
      setError('No se pudo cargar el detalle');
    }
  };

  if (detalle) {
    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <h1 className="titulo">Lote {detalle.numeroLote}</h1>
            <p className="sutil">{ESTADOS_CICLO[detalle.estado] ?? detalle.estado}</p>
          </div>
          <button type="button" className="boton boton--texto" onClick={() => setDetalle(null)}>
            Volver
          </button>
        </header>

        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Datos</h2>
          <dl className="ficha">
            <dt>Equipo</dt>
            <dd>{equipos.find((e) => e.id === detalle.equipoId)?.nombre ?? detalle.equipoId}</dd>
            <dt>Método</dt>
            <dd>{METODOS.find((m) => m.valor === detalle.metodo)?.etiqueta ?? detalle.metodo}</dd>
            <dt>Iniciado</dt>
            <dd>{fechaLocal(detalle.iniciadoEn)}</dd>
            <dt>Finalizado</dt>
            <dd>{fechaLocal(detalle.finalizadoEn)}</dd>
            <dt>Liberado</dt>
            <dd>{fechaLocal(detalle.liberadoEn)}</dd>
            <dt>Control físico</dt>
            <dd>{detalle.controlFisico ?? 'Sin cargar'}</dd>
            <dt>Control químico</dt>
            <dd>{detalle.controlQuimico ?? 'Sin cargar'}</dd>
            <dt>Control biológico</dt>
            <dd>{detalle.controlBiologico ?? 'Sin cargar'}</dd>
          </dl>
        </section>

        <section>
          <h2 className="tarjeta__titulo">Cajas ({detalle.cajas.length})</h2>
          <ul className="lista-admin">
            {detalle.cajas.map((c) => (
              <li key={c.id} className="admin">
                <div className="admin__datos">
                  <strong>{c.codigo}</strong>
                  <span className="sutil">{c.nombre}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Esterilización</h1>
          <p className="sutil">Ciclos, controles y liberación de lotes</p>
        </div>
        <div className="cabecera__acciones">
          <button
            type="button"
            className="boton boton--primario boton--chico"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : '+ Nuevo ciclo'}
          </button>
          <button type="button" className="boton boton--texto" onClick={onVolver}>
            Volver
          </button>
        </div>
      </header>

      {error && <p className="aviso aviso--error">{error}</p>}
      {exito && <p className="aviso aviso--ok">{exito}</p>}

      {mostrarForm && (
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Nuevo ciclo</h2>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              if (!enviando) void crear();
            }}
          >
            <label className="campo">
              <span className="campo__etiqueta">Número de lote</span>
              <input
                className="campo__control"
                value={numeroLote}
                onChange={(e) => setNumeroLote(e.target.value)}
                placeholder="Ej: 2026-001"
                maxLength={40}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Equipo esterilizador</span>
              <select
                className="campo__control"
                value={equipoId}
                onChange={(e) => setEquipoId(e.target.value)}
              >
                {equipos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Método</span>
              <select
                className="campo__control"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
              >
                {METODOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Códigos de cajas (uno por línea o separados por coma)</span>
              <textarea
                className="campo__control"
                value={cajaRefs}
                onChange={(e) => setCajaRefs(e.target.value)}
                rows={4}
                placeholder={'LAP-01\nLAP-02\nORTO-05'}
              />
            </label>

            <button
              type="submit"
              className="boton boton--primario"
              disabled={!numeroLote.trim() || !equipoId || enviando}
            >
              {enviando ? 'Creando...' : 'Crear ciclo'}
            </button>
          </form>
        </section>
      )}

      {cicloControlando && (
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Cargar controles</h2>
          <div className="formulario">
            <label className="campo">
              <span className="campo__etiqueta">Control físico</span>
              <select
                className="campo__control"
                value={controlFisico}
                onChange={(e) => setControlFisico(e.target.value)}
              >
                {RESULTADOS_CONTROL.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo__etiqueta">Control químico</span>
              <select
                className="campo__control"
                value={controlQuimico}
                onChange={(e) => setControlQuimico(e.target.value)}
              >
                {RESULTADOS_CONTROL.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo__etiqueta">Control biológico</span>
              <select
                className="campo__control"
                value={controlBiologico}
                onChange={(e) => setControlBiologico(e.target.value)}
              >
                {RESULTADOS_CONTROL.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
            </label>
            <div className="acciones">
              <button
                type="button"
                className="boton boton--primario"
                onClick={() => void cargarControles(cicloControlando)}
              >
                Guardar controles
              </button>
              <button
                type="button"
                className="boton boton--secundario"
                onClick={() => setCicloControlando(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </section>
      )}

      <section>
        {cargando && <p className="sutil">Cargando...</p>}
        <ul className="lista-admin">
          {ciclos.map((ciclo) => (
            <li key={ciclo.id} className="admin">
              <div className="admin__datos">
                <strong>Lote {ciclo.numeroLote}</strong>
                <span className="sutil">
                  {equipos.find((e) => e.id === ciclo.equipoId)?.nombre ?? ciclo.equipoId}
                  {' · '}
                  {METODOS.find((m) => m.valor === ciclo.metodo)?.etiqueta ?? ciclo.metodo}
                </span>
                <span className="admin__rol">{ESTADOS_CICLO[ciclo.estado] ?? ciclo.estado}</span>
                <span className="sutil">{fechaLocal(ciclo.iniciadoEn)}</span>
              </div>

              <div className="admin__acciones">
                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void verDetalle(ciclo.id)}
                >
                  Ver cajas
                </button>

                {ciclo.estado === 'en_proceso' && (
                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => void finalizar(ciclo.id)}
                  >
                    Finalizar
                  </button>
                )}

                {ciclo.estado === 'finalizado' && (
                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => {
                      setCicloControlando(ciclo.id);
                      setControlFisico('conforme');
                      setControlQuimico('conforme');
                      setControlBiologico('pendiente');
                    }}
                  >
                    Cargar controles
                  </button>
                )}

                {ciclo.estado === 'finalizado' && esSupervisorOAdmin && (
                  <button
                    type="button"
                    className="boton boton--primario boton--chico"
                    onClick={() => void liberar(ciclo.id)}
                  >
                    Liberar lote
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!cargando && ciclos.length === 0 && (
          <p className="sutil">No hay ciclos registrados todavía.</p>
        )}
      </section>
    </main>
  );
}
