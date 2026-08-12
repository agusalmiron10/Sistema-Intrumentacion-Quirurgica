import { useEffect, useState } from 'react';

import { ErrorApi, pedir } from '../lib/api';

interface Props {
  onVolver: () => void;
}

interface Cirujano {
  id: string;
  nombre: string;
}

interface Procedimiento {
  id: string;
  nombre: string;
}

interface Cirugia {
  id: string;
  pacienteRef: string;
  procedimientoId: string;
  cirujanoId: string;
  estado: string;
  programadaPara: string;
  quirofano: string | null;
}

interface CirugiaDetalle extends Cirugia {
  cajas: { cajaId: string; codigo: string; nombre: string; usada: boolean }[];
  descartables: { descartableId: string; nombre: string; cantidad: number }[];
}

const ESTADOS_CIRUGIA: Record<string, string> = {
  programada: 'Programada',
  preparada: 'Preparada',
  en_curso: 'En curso',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const ESTADOS_SIGUIENTES: Record<string, string[]> = {
  programada: ['preparada', 'cancelada'],
  preparada: ['en_curso', 'cancelada'],
  en_curso: ['finalizada'],
  finalizada: [],
  cancelada: [],
};

function fechaLocal(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Pantalla de gestión de cirugías. */
export function Cirugias({ onVolver }: Props) {
  const [cirugias, setCirugias] = useState<Cirugia[]>([]);
  const [cirujanos, setCirujanos] = useState<Cirujano[]>([]);
  const [procedimientos, setProcedimientos] = useState<Procedimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<CirugiaDetalle | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // Formulario nueva cirugía
  const [pacienteRef, setPacienteRef] = useState('');
  const [procedimientoId, setProcedimientoId] = useState('');
  const [cirujanoId, setCirujanoId] = useState('');
  const [programadaPara, setProgramadaPara] = useState('');
  const [quirofano, setQuirofano] = useState('');

  const recargar = async (): Promise<void> => {
    try {
      const [lista, cirjs, procs] = await Promise.all([
        pedir<Cirugia[]>('/api/cirugias'),
        pedir<Cirujano[]>('/api/cirujanos'),
        pedir<Procedimiento[]>('/api/procedimientos'),
      ]);
      setCirugias(lista);
      setCirujanos(cirjs);
      setProcedimientos(procs);
      if (cirjs.length > 0 && !cirujanoId) setCirujanoId(cirjs[0]!.id);
      if (procs.length > 0 && !procedimientoId) setProcedimientoId(procs[0]!.id);
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
      await pedir('/api/cirugias', {
        metodo: 'POST',
        cuerpo: {
          pacienteRef: pacienteRef.trim(),
          procedimientoId,
          cirujanoId,
          programadaPara: new Date(programadaPara).toISOString(),
          ...(quirofano.trim() ? { quirofano: quirofano.trim() } : {}),
        },
      });
      setExito('Cirugía programada.');
      setPacienteRef('');
      setQuirofano('');
      setProgramadaPara('');
      setMostrarForm(false);
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo crear la cirugía');
    } finally {
      setEnviando(false);
    }
  };

  const cambiarEstado = async (id: string, estado: string): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      await pedir(`/api/cirugias/${id}/estado`, {
        metodo: 'POST',
        cuerpo: { estado, ocurridoEn: new Date().toISOString() },
      });
      setExito(`Estado actualizado a "${ESTADOS_CIRUGIA[estado] ?? estado}".`);
      if (detalle?.id === id) {
        const d = await pedir<CirugiaDetalle>(`/api/cirugias/${id}`);
        setDetalle(d);
      }
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo cambiar el estado');
    }
  };

  const verDetalle = async (id: string): Promise<void> => {
    try {
      const d = await pedir<CirugiaDetalle>(`/api/cirugias/${id}`);
      setDetalle(d);
    } catch {
      setError('No se pudo cargar el detalle');
    }
  };

  if (detalle) {
    const siguientes = ESTADOS_SIGUIENTES[detalle.estado] ?? [];
    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <h1 className="titulo">Cirugía #{detalle.id.slice(-6)}</h1>
            <p className="sutil">{ESTADOS_CIRUGIA[detalle.estado] ?? detalle.estado}</p>
          </div>
          <button type="button" className="boton boton--texto" onClick={() => setDetalle(null)}>
            Volver
          </button>
        </header>

        {error && <p className="aviso aviso--error">{error}</p>}
        {exito && <p className="aviso aviso--ok">{exito}</p>}

        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Datos</h2>
          <dl className="ficha">
            <dt>Paciente ref.</dt>
            <dd>{detalle.pacienteRef}</dd>
            <dt>Procedimiento</dt>
            <dd>{procedimientos.find((p) => p.id === detalle.procedimientoId)?.nombre ?? detalle.procedimientoId}</dd>
            <dt>Cirujano</dt>
            <dd>{cirujanos.find((c) => c.id === detalle.cirujanoId)?.nombre ?? detalle.cirujanoId}</dd>
            <dt>Programada</dt>
            <dd>{fechaLocal(detalle.programadaPara)}</dd>
            {detalle.quirofano && <><dt>Quirófano</dt><dd>{detalle.quirofano}</dd></>}
          </dl>

          {siguientes.length > 0 && (
            <div className="acciones" style={{ marginTop: '1rem' }}>
              {siguientes.map((sig) => (
                <button
                  key={sig}
                  type="button"
                  className={`boton boton--chico ${sig === 'cancelada' ? 'boton--secundario' : 'boton--primario'}`}
                  onClick={() => void cambiarEstado(detalle.id, sig)}
                >
                  → {ESTADOS_CIRUGIA[sig] ?? sig}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="tarjeta__titulo">Cajas asignadas ({detalle.cajas.length})</h2>
          {detalle.cajas.length === 0 ? (
            <p className="sutil">Sin cajas asignadas. Se asignan al pasar a "Preparada".</p>
          ) : (
            <ul className="lista-admin">
              {detalle.cajas.map((c) => (
                <li key={c.cajaId} className="admin">
                  <div className="admin__datos">
                    <strong>{c.codigo}</strong>
                    <span className="sutil">{c.nombre}</span>
                    {c.usada && <span className="admin__rol">Usada</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {detalle.descartables.length > 0 && (
          <section>
            <h2 className="tarjeta__titulo">Descartables planificados</h2>
            <ul className="lista-admin">
              {detalle.descartables.map((d) => (
                <li key={d.descartableId} className="admin">
                  <div className="admin__datos">
                    <strong>{d.nombre}</strong>
                    <span className="sutil">Cantidad: {d.cantidad}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Cirugías</h1>
          <p className="sutil">Programación y seguimiento de intervenciones</p>
        </div>
        <div className="cabecera__acciones">
          <button
            type="button"
            className="boton boton--primario boton--chico"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : '+ Nueva'}
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
          <h2 className="tarjeta__titulo">Nueva cirugía</h2>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              if (!enviando) void crear();
            }}
          >
            <label className="campo">
              <span className="campo__etiqueta">Referencia del paciente</span>
              <input
                className="campo__control"
                value={pacienteRef}
                onChange={(e) => setPacienteRef(e.target.value)}
                placeholder="Ej: HC-123456 (sin datos clínicos)"
                maxLength={64}
              />
              <span className="campo__ayuda">Solo un identificador opaco. Sin nombre ni diagnóstico.</span>
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Procedimiento</span>
              <select
                className="campo__control"
                value={procedimientoId}
                onChange={(e) => setProcedimientoId(e.target.value)}
              >
                {procedimientos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Cirujano</span>
              <select
                className="campo__control"
                value={cirujanoId}
                onChange={(e) => setCirujanoId(e.target.value)}
              >
                {cirujanos.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Fecha y hora programada</span>
              <input
                className="campo__control"
                type="datetime-local"
                value={programadaPara}
                onChange={(e) => setProgramadaPara(e.target.value)}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Quirófano (opcional)</span>
              <input
                className="campo__control"
                value={quirofano}
                onChange={(e) => setQuirofano(e.target.value)}
                placeholder="Ej: Q1"
                maxLength={20}
              />
            </label>

            <button
              type="submit"
              className="boton boton--primario"
              disabled={!pacienteRef.trim() || !procedimientoId || !cirujanoId || !programadaPara || enviando}
            >
              {enviando ? 'Guardando...' : 'Programar cirugía'}
            </button>
          </form>
        </section>
      )}

      <section>
        {cargando && <p className="sutil">Cargando...</p>}
        <ul className="lista-admin">
          {cirugias.map((c) => (
            <li
              key={c.id}
              className={`admin ${c.estado === 'cancelada' ? 'admin--baja' : ''}`}
            >
              <div className="admin__datos">
                <strong>Pac. {c.pacienteRef}</strong>
                <span className="sutil">
                  {procedimientos.find((p) => p.id === c.procedimientoId)?.nombre ?? c.procedimientoId}
                </span>
                <span className="sutil">
                  {cirujanos.find((cj) => cj.id === c.cirujanoId)?.nombre ?? c.cirujanoId}
                </span>
                <span className="admin__rol">{ESTADOS_CIRUGIA[c.estado] ?? c.estado}</span>
                <span className="sutil">{fechaLocal(c.programadaPara)}</span>
                {c.quirofano && <span className="sutil">Quirófano {c.quirofano}</span>}
              </div>
              <div className="admin__acciones">
                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void verDetalle(c.id)}
                >
                  Ver
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!cargando && cirugias.length === 0 && (
          <p className="sutil">No hay cirugías programadas.</p>
        )}
      </section>
    </main>
  );
}
