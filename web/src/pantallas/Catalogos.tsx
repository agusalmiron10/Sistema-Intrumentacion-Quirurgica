import { useEffect, useState } from 'react';

import { ErrorApi, pedir } from '../lib/api';

interface Props {
  onVolver: () => void;
}

interface Cirujano {
  id: string;
  nombre: string;
  matricula: string;
  especialidad: string | null;
  notas: string | null;
  activo: number;
}

interface Procedimiento {
  id: string;
  nombre: string;
  codigo: string;
  especialidad: string | null;
  duracionMin: number | null;
  activo: number;
}

interface InstrumentoTipo {
  id: string;
  nombre: string;
  codigo: string;
  fabricante: string | null;
  termosensible: number;
  activo: number;
}

type Tab = 'cirujanos' | 'procedimientos' | 'instrumentos';

/** Gestión de catálogos: cirujanos, procedimientos e instrumentos. Solo admin. */
export function Catalogos({ onVolver }: Props) {
  const [tab, setTab] = useState<Tab>('cirujanos');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  // ── Cirujanos ──
  const [cirujanos, setCirujanos] = useState<Cirujano[]>([]);
  const [cargandoCirujanos, setCargandoCirujanos] = useState(true);
  const [nombreCirujano, setNombreCirujano] = useState('');
  const [matricula, setMatricula] = useState('');
  const [especialidadCirujano, setEspecialidadCirujano] = useState('');
  const [notasCirujano, setNotasCirujano] = useState('');
  const [enviandoCirujano, setEnviandoCirujano] = useState(false);

  // ── Procedimientos ──
  const [procedimientos, setProcedimientos] = useState<Procedimiento[]>([]);
  const [cargandoProcedimientos, setCargandoProcedimientos] = useState(true);
  const [nombreProc, setNombreProc] = useState('');
  const [codigoProc, setCodigoProc] = useState('');
  const [especialidadProc, setEspecialidadProc] = useState('');
  const [duracionMin, setDuracionMin] = useState('');
  const [enviandoProc, setEnviandoProc] = useState(false);

  // ── Instrumentos ──
  const [instrumentos, setInstrumentos] = useState<InstrumentoTipo[]>([]);
  const [cargandoInstrumentos, setCargandoInstrumentos] = useState(true);
  const [nombreInstr, setNombreInstr] = useState('');
  const [codigoInstr, setCodigoInstr] = useState('');
  const [fabricante, setFabricante] = useState('');
  const [termosensible, setTermosensible] = useState(false);
  const [enviandoInstr, setEnviandoInstr] = useState(false);

  const limpiarAlerts = () => { setError(null); setExito(null); };

  // ── Cargar datos ──
  useEffect(() => {
    void pedir<Cirujano[]>('/api/cirujanos')
      .then(setCirujanos)
      .catch(() => undefined)
      .finally(() => setCargandoCirujanos(false));
  }, []);

  useEffect(() => {
    void pedir<Procedimiento[]>('/api/procedimientos')
      .then(setProcedimientos)
      .catch(() => undefined)
      .finally(() => setCargandoProcedimientos(false));
  }, []);

  useEffect(() => {
    void pedir<InstrumentoTipo[]>('/api/instrumentos')
      .then(setInstrumentos)
      .catch(() => undefined)
      .finally(() => setCargandoInstrumentos(false));
  }, []);

  // ── Acciones cirujanos ──
  const crearCirujano = async (): Promise<void> => {
    limpiarAlerts();
    setEnviandoCirujano(true);
    try {
      const nuevo = await pedir<Cirujano>('/api/admin/cirujanos', {
        metodo: 'POST',
        cuerpo: {
          nombre: nombreCirujano.trim(),
          matricula: matricula.trim(),
          especialidad: especialidadCirujano.trim() || null,
          notas: notasCirujano.trim() || null,
        },
      });
      setCirujanos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNombreCirujano(''); setMatricula(''); setEspecialidadCirujano(''); setNotasCirujano('');
      setExito(`${nuevo.nombre} dado de alta.`);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo crear el cirujano');
    } finally {
      setEnviandoCirujano(false);
    }
  };

  const toggleCirujano = async (c: Cirujano): Promise<void> => {
    limpiarAlerts();
    try {
      await pedir(`/api/admin/cirujanos/${c.id}`, {
        metodo: 'PATCH',
        cuerpo: { activo: c.activo === 0 },
      });
      setCirujanos((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, activo: c.activo === 0 ? 1 : 0 } : x)),
      );
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo actualizar');
    }
  };

  // ── Acciones procedimientos ──
  const crearProcedimiento = async (): Promise<void> => {
    limpiarAlerts();
    setEnviandoProc(true);
    try {
      const nuevo = await pedir<Procedimiento>('/api/admin/procedimientos', {
        metodo: 'POST',
        cuerpo: {
          nombre: nombreProc.trim(),
          codigo: codigoProc.trim(),
          especialidad: especialidadProc.trim() || null,
          duracionMin: duracionMin ? Number(duracionMin) : null,
        },
      });
      setProcedimientos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNombreProc(''); setCodigoProc(''); setEspecialidadProc(''); setDuracionMin('');
      setExito(`${nuevo.nombre} creado.`);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo crear el procedimiento');
    } finally {
      setEnviandoProc(false);
    }
  };

  const toggleProcedimiento = async (p: Procedimiento): Promise<void> => {
    limpiarAlerts();
    try {
      await pedir(`/api/admin/procedimientos/${p.id}`, {
        metodo: 'PATCH',
        cuerpo: { activo: p.activo === 0 },
      });
      setProcedimientos((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, activo: p.activo === 0 ? 1 : 0 } : x)),
      );
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo actualizar');
    }
  };

  // ── Acciones instrumentos ──
  const crearInstrumento = async (): Promise<void> => {
    limpiarAlerts();
    setEnviandoInstr(true);
    try {
      const nuevo = await pedir<InstrumentoTipo>('/api/admin/instrumentos', {
        metodo: 'POST',
        cuerpo: {
          nombre: nombreInstr.trim(),
          codigo: codigoInstr.trim(),
          fabricante: fabricante.trim() || null,
          termosensible,
        },
      });
      setInstrumentos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNombreInstr(''); setCodigoInstr(''); setFabricante(''); setTermosensible(false);
      setExito(`${nuevo.nombre} creado.`);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo crear el instrumento');
    } finally {
      setEnviandoInstr(false);
    }
  };

  const toggleInstrumento = async (i: InstrumentoTipo): Promise<void> => {
    limpiarAlerts();
    try {
      await pedir(`/api/admin/instrumentos/${i.id}`, {
        metodo: 'PATCH',
        cuerpo: { activo: i.activo === 0 },
      });
      setInstrumentos((prev) =>
        prev.map((x) => (x.id === i.id ? { ...x, activo: i.activo === 0 ? 1 : 0 } : x)),
      );
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo actualizar');
    }
  };

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Catálogos</h1>
          <p className="sutil">Cirujanos, procedimientos e instrumental</p>
        </div>
        <button type="button" className="boton boton--texto" onClick={onVolver}>
          Volver
        </button>
      </header>

      {error && <p className="aviso aviso--error">{error}</p>}
      {exito && <p className="aviso aviso--ok">{exito}</p>}

      <div className="tabs">
        {(['cirujanos', 'procedimientos', 'instrumentos'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`tab ${tab === t ? 'tab--activo' : ''}`}
            onClick={() => { setTab(t); limpiarAlerts(); }}
          >
            {t === 'cirujanos' ? '👨‍⚕️ Cirujanos' : t === 'procedimientos' ? '🩺 Procedimientos' : '🔧 Instrumental'}
          </button>
        ))}
      </div>

      {/* ── Tab: Cirujanos ── */}
      {tab === 'cirujanos' && (
        <>
          <section className="tarjeta">
            <h2 className="tarjeta__titulo">Agregar cirujano</h2>
            <form
              className="formulario"
              onSubmit={(e) => { e.preventDefault(); if (!enviandoCirujano) void crearCirujano(); }}
            >
              <div className="formulario__fila">
                <label className="campo" style={{ flex: 2 }}>
                  <span className="campo__etiqueta">Nombre y apellido</span>
                  <input className="campo__control" value={nombreCirujano} onChange={(e) => setNombreCirujano(e.target.value)} maxLength={120} required />
                </label>
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Matrícula</span>
                  <input className="campo__control" value={matricula} onChange={(e) => setMatricula(e.target.value)} maxLength={40} required />
                </label>
              </div>
              <div className="formulario__fila">
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Especialidad</span>
                  <input className="campo__control" value={especialidadCirujano} onChange={(e) => setEspecialidadCirujano(e.target.value)} maxLength={80} />
                </label>
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Notas</span>
                  <input className="campo__control" value={notasCirujano} onChange={(e) => setNotasCirujano(e.target.value)} maxLength={200} />
                </label>
              </div>
              <button type="submit" className="boton boton--primario" disabled={!nombreCirujano.trim() || !matricula.trim() || enviandoCirujano}>
                {enviandoCirujano ? 'Guardando...' : 'Agregar'}
              </button>
            </form>
          </section>

          <section>
            {cargandoCirujanos && <p className="sutil">Cargando...</p>}
            <ul className="lista-catalogo">
              {cirujanos.map((c) => (
                <li key={c.id} className={`catalogo-item ${c.activo === 0 ? 'catalogo-item--baja' : ''}`}>
                  <div className="catalogo-item__datos">
                    <strong>{c.nombre}</strong>
                    <span className="sutil">Mat. {c.matricula}{c.especialidad ? ` · ${c.especialidad}` : ''}</span>
                    {c.notas && <span className="sutil">{c.notas}</span>}
                  </div>
                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => void toggleCirujano(c)}
                  >
                    {c.activo === 0 ? 'Reactivar' : 'Dar de baja'}
                  </button>
                </li>
              ))}
            </ul>
            {!cargandoCirujanos && cirujanos.length === 0 && (
              <p className="sutil">Todavía no hay cirujanos en el sistema.</p>
            )}
          </section>
        </>
      )}

      {/* ── Tab: Procedimientos ── */}
      {tab === 'procedimientos' && (
        <>
          <section className="tarjeta">
            <h2 className="tarjeta__titulo">Agregar procedimiento</h2>
            <form
              className="formulario"
              onSubmit={(e) => { e.preventDefault(); if (!enviandoProc) void crearProcedimiento(); }}
            >
              <div className="formulario__fila">
                <label className="campo" style={{ flex: 2 }}>
                  <span className="campo__etiqueta">Nombre</span>
                  <input className="campo__control" value={nombreProc} onChange={(e) => setNombreProc(e.target.value)} maxLength={120} required />
                </label>
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Código</span>
                  <input
                    className="campo__control"
                    value={codigoProc}
                    onChange={(e) => setCodigoProc(e.target.value.toUpperCase())}
                    maxLength={20}
                    required
                    placeholder="LAP-01"
                  />
                </label>
              </div>
              <div className="formulario__fila">
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Especialidad</span>
                  <input className="campo__control" value={especialidadProc} onChange={(e) => setEspecialidadProc(e.target.value)} maxLength={80} />
                </label>
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Duración estimada (min)</span>
                  <input
                    className="campo__control"
                    type="number"
                    min={1}
                    max={600}
                    value={duracionMin}
                    onChange={(e) => setDuracionMin(e.target.value)}
                    placeholder="90"
                  />
                </label>
              </div>
              <button type="submit" className="boton boton--primario" disabled={!nombreProc.trim() || !codigoProc.trim() || enviandoProc}>
                {enviandoProc ? 'Guardando...' : 'Agregar'}
              </button>
            </form>
          </section>

          <section>
            {cargandoProcedimientos && <p className="sutil">Cargando...</p>}
            <ul className="lista-catalogo">
              {procedimientos.map((p) => (
                <li key={p.id} className={`catalogo-item ${p.activo === 0 ? 'catalogo-item--baja' : ''}`}>
                  <div className="catalogo-item__datos">
                    <strong>{p.nombre}</strong>
                    <span className="sutil">{p.codigo}{p.especialidad ? ` · ${p.especialidad}` : ''}{p.duracionMin ? ` · ${p.duracionMin} min` : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => void toggleProcedimiento(p)}
                  >
                    {p.activo === 0 ? 'Reactivar' : 'Dar de baja'}
                  </button>
                </li>
              ))}
            </ul>
            {!cargandoProcedimientos && procedimientos.length === 0 && (
              <p className="sutil">Todavía no hay procedimientos en el sistema.</p>
            )}
          </section>
        </>
      )}

      {/* ── Tab: Instrumental ── */}
      {tab === 'instrumentos' && (
        <>
          <section className="tarjeta">
            <h2 className="tarjeta__titulo">Agregar tipo de instrumento</h2>
            <form
              className="formulario"
              onSubmit={(e) => { e.preventDefault(); if (!enviandoInstr) void crearInstrumento(); }}
            >
              <div className="formulario__fila">
                <label className="campo" style={{ flex: 2 }}>
                  <span className="campo__etiqueta">Nombre</span>
                  <input className="campo__control" value={nombreInstr} onChange={(e) => setNombreInstr(e.target.value)} maxLength={120} required />
                </label>
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Código</span>
                  <input
                    className="campo__control"
                    value={codigoInstr}
                    onChange={(e) => setCodigoInstr(e.target.value.toUpperCase())}
                    maxLength={32}
                    required
                    placeholder="BIS-001"
                  />
                </label>
              </div>
              <div className="formulario__fila">
                <label className="campo" style={{ flex: 1 }}>
                  <span className="campo__etiqueta">Fabricante</span>
                  <input className="campo__control" value={fabricante} onChange={(e) => setFabricante(e.target.value)} maxLength={80} />
                </label>
                <label className="campo campo--checkbox" style={{ flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={termosensible}
                    onChange={(e) => setTermosensible(e.target.checked)}
                    className="campo__checkbox"
                  />
                  <span>
                    <span className="campo__etiqueta">Termosensible</span>
                    <span className="campo__ayuda">No tolera vapor a 134 °C</span>
                  </span>
                </label>
              </div>
              <button type="submit" className="boton boton--primario" disabled={!nombreInstr.trim() || !codigoInstr.trim() || enviandoInstr}>
                {enviandoInstr ? 'Guardando...' : 'Agregar'}
              </button>
            </form>
          </section>

          <section>
            {cargandoInstrumentos && <p className="sutil">Cargando...</p>}
            <ul className="lista-catalogo">
              {instrumentos.map((i) => (
                <li key={i.id} className={`catalogo-item ${i.activo === 0 ? 'catalogo-item--baja' : ''}`}>
                  <div className="catalogo-item__datos">
                    <strong>{i.nombre}</strong>
                    <span className="sutil">
                      {i.codigo}
                      {i.fabricante ? ` · ${i.fabricante}` : ''}
                      {i.termosensible === 1 && ' · ⚠️ Termosensible'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => void toggleInstrumento(i)}
                  >
                    {i.activo === 0 ? 'Reactivar' : 'Dar de baja'}
                  </button>
                </li>
              ))}
            </ul>
            {!cargandoInstrumentos && instrumentos.length === 0 && (
              <p className="sutil">Todavía no hay tipos de instrumento en el sistema.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
