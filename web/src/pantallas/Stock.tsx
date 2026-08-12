import { useEffect, useState } from 'react';

import { ErrorApi, pedir } from '../lib/api';

interface Props {
  onVolver: () => void;
}

interface Existencia {
  id: string;
  nombre: string;
  codigo: string;
  unidad: string;
  puntoReposicion: number;
  disponible: number;
  vencido: number;
  porVencer: number;
}

interface Alerta {
  id: string;
  nombre: string;
  codigo: string;
  unidad: string;
  tipo: 'reposicion' | 'por_vencer' | 'vencido';
  disponible?: number;
  cantidad?: number;
  venceEl?: string;
  puntoReposicion?: number;
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('es-AR');
}

/** Pantalla de stock de descartables. */
export function Stock({ onVolver }: Props) {
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [tab, setTab] = useState<'stock' | 'alertas' | 'lote' | 'descartable' | 'movimiento'>('stock');

  // Recibir lote
  const [descartableRef, setDescartableRef] = useState('');
  const [numeroLote, setNumeroLote] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [venceEl, setVenceEl] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Nuevo descartable
  const [ndNombre, setNdNombre] = useState('');
  const [ndCodigo, setNdCodigo] = useState('');
  const [ndUnidad, setNdUnidad] = useState('');
  const [ndUnidad, setNdUnidad] = useState('');
  const [ndPunto, setNdPunto] = useState('0');

  // Movimiento manual
  const [movimientoDescartable, setMovimientoDescartable] = useState<Existencia | null>(null);
  const [movLotes, setMovLotes] = useState<{ id: string; numeroLote: string; cantidadActual: number }[]>([]);
  const [movLoteId, setMovLoteId] = useState('');
  const [movTipo, setMovTipo] = useState<'ajuste' | 'devolucion' | 'vencido'>('ajuste');
  const [movCantidad, setMovCantidad] = useState('');
  const [movMotivo, setMovMotivo] = useState('');

  const recargar = async (): Promise<void> => {
    try {
      const [ex, al] = await Promise.all([
        pedir<Existencia[]>('/api/stock'),
        pedir<Alerta[]>('/api/stock/alertas'),
      ]);
      setExistencias(ex);
      setAlertas(al);
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo cargar el stock');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void recargar();
  }, []);

  const recibirLote = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      await pedir('/api/stock/lotes', {
        metodo: 'POST',
        cuerpo: {
          descartableRef: descartableRef.trim(),
          numeroLote: numeroLote.trim(),
          cantidad: Number(cantidad),
          ...(venceEl ? { venceEl: new Date(venceEl).toISOString() } : {}),
        },
      });
      setExito(`Lote "${numeroLote.trim()}" recibido correctamente.`);
      setDescartableRef('');
      setNumeroLote('');
      setCantidad('');
      setVenceEl('');
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo registrar el lote');
    } finally {
      setEnviando(false);
    }
  };

  const crearDescartable = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      await pedir('/api/stock/descartables', {
        metodo: 'POST',
        cuerpo: {
          nombre: ndNombre.trim(),
          codigo: ndCodigo.trim().toUpperCase(),
          unidad: ndUnidad.trim(),
          puntoReposicion: Number(ndPunto),
        },
      });
      setExito(`Descartable "${ndNombre.trim()}" creado.`);
      setNdNombre('');
      setNdCodigo('');
      setNdUnidad('');
      setNdPunto('0');
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo crear el descartable');
    } finally {
      setEnviando(false);
    }
  };

  const descartarVencidos = async (): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      const r = await pedir<{ dados: number }>('/api/stock/descartar-vencidos', {
        metodo: 'POST',
        cuerpo: {},
      });
      setExito(`Se dieron de baja ${r.dados} lote(s) vencido(s).`);
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'Error al descartar vencidos');
    }
  };

  const iniciarMovimiento = async (ex: Existencia): Promise<void> => {
    setTab('movimiento');
    setMovimientoDescartable(ex);
    setMovLotes([]);
    setMovLoteId('');
    setMovCantidad('');
    setMovMotivo('');
    setError(null);
    setExito(null);
    try {
      const resp = await pedir<{ lotes: { id: string; numeroLote: string; cantidadActual: number }[] }>(`/api/stock/descartables/${ex.id}/lotes`);
      setMovLotes(resp.lotes);
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudieron cargar los lotes');
    }
  };

  const registrarMovimiento = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      await pedir('/api/stock/movimientos', {
        metodo: 'POST',
        cuerpo: {
          loteId: movLoteId,
          tipo: movTipo,
          cantidad: Number(movCantidad),
          motivo: movMotivo.trim() || null,
        },
      });
      setExito(`Movimiento registrado correctamente.`);
      setTab('stock');
      await recargar();
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo registrar el movimiento');
    } finally {
      setEnviando(false);
    }
  };

  const tabClass = (t: string) =>
    `boton boton--chico ${tab === t ? 'boton--primario' : 'boton--secundario'}`;

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Stock de descartables</h1>
          <p className="sutil">Lotes, existencias y alertas de reposición</p>
        </div>
        <button type="button" className="boton boton--texto" onClick={onVolver}>
          Volver
        </button>
      </header>

      {error && <p className="aviso aviso--error">{error}</p>}
      {exito && <p className="aviso aviso--ok">{exito}</p>}

      <div className="acciones" style={{ marginBottom: '1rem' }}>
        <button className={tabClass('stock')} onClick={() => setTab('stock')}>
          Stock actual
        </button>
        <button className={tabClass('alertas')} onClick={() => setTab('alertas')}>
          Alertas {alertas.length > 0 && `(${alertas.length})`}
        </button>
        <button className={tabClass('lote')} onClick={() => setTab('lote')}>
          Recibir lote
        </button>
        <button className={tabClass('descartable')} onClick={() => setTab('descartable')}>
          + Descartable
        </button>
        {tab === 'movimiento' && (
          <button className={tabClass('movimiento')} onClick={() => setTab('movimiento')}>
            Movimiento manual
          </button>
        )}
      </div>

      {tab === 'stock' && (
        <section>
          {cargando && <p className="sutil">Cargando...</p>}
          {!cargando && existencias.length === 0 && (
            <p className="sutil">No hay descartables cargados. Creá uno primero.</p>
          )}
          <ul className="lista-admin">
            {existencias.map((ex) => (
              <li key={ex.id} className={`admin ${ex.disponible <= ex.puntoReposicion ? 'admin--baja' : ''}`}>
                <div className="admin__datos">
                  <strong>{ex.nombre}</strong>
                  <span className="sutil">{ex.codigo} · {ex.unidad}</span>
                  <span className="admin__rol">
                    Disponible: {ex.disponible} {ex.unidad}
                  </span>
                  {ex.vencido > 0 && (
                    <span className="admin__estado">{ex.vencido} vencido(s)</span>
                  )}
                  {ex.disponible <= ex.puntoReposicion && (
                    <span className="admin__estado">⚠ Reponer (mínimo: {ex.puntoReposicion})</span>
                  )}
                </div>
                <div className="admin__acciones">
                  <button
                    type="button"
                    className="boton boton--secundario boton--chico"
                    onClick={() => void iniciarMovimiento(ex)}
                  >
                    Ajustar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'alertas' && (
        <section>
          {alertas.length === 0 ? (
            <p className="sutil">Sin alertas. ✓</p>
          ) : (
            <>
              {alertas.some((a) => a.tipo === 'vencido') && (
                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void descartarVencidos()}
                  style={{ marginBottom: '1rem' }}
                >
                  Dar de baja todos los vencidos
                </button>
              )}
              <ul className="lista-admin">
                {alertas.map((a, i) => (
                  <li key={i} className="admin admin--baja">
                    <div className="admin__datos">
                      <strong>{a.nombre}</strong>
                      <span className="sutil">{a.codigo}</span>
                      <span className="admin__rol">
                        {a.tipo === 'reposicion' && `⚠ Stock bajo: ${a.disponible} (mínimo ${a.puntoReposicion})`}
                        {a.tipo === 'por_vencer' && `⏳ Vence ${fechaCorta(a.venceEl)}: ${a.cantidad} unidades`}
                        {a.tipo === 'vencido' && `✕ Vencido ${fechaCorta(a.venceEl)}: ${a.cantidad} unidades`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {tab === 'lote' && (
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Recibir lote</h2>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              if (!enviando) void recibirLote();
            }}
          >
            <label className="campo">
              <span className="campo__etiqueta">Código o ID del descartable</span>
              <input
                className="campo__control"
                value={descartableRef}
                onChange={(e) => setDescartableRef(e.target.value)}
                placeholder="Ej: STURA-VICRYL-30"
                list="desc-list"
              />
              <datalist id="desc-list">
                {existencias.map((ex) => (
                  <option key={ex.id} value={ex.codigo}>{ex.nombre}</option>
                ))}
              </datalist>
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Número de lote del proveedor</span>
              <input
                className="campo__control"
                value={numeroLote}
                onChange={(e) => setNumeroLote(e.target.value)}
                maxLength={40}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Cantidad</span>
              <input
                className="campo__control"
                type="number"
                min="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Fecha de vencimiento (opcional)</span>
              <input
                className="campo__control"
                type="date"
                value={venceEl}
                onChange={(e) => setVenceEl(e.target.value)}
              />
            </label>

            <button
              type="submit"
              className="boton boton--primario"
              disabled={!descartableRef.trim() || !numeroLote.trim() || !cantidad || enviando}
            >
              {enviando ? 'Guardando...' : 'Registrar recepción'}
            </button>
          </form>
        </section>
      )}

      {tab === 'descartable' && (
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Nuevo descartable</h2>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              if (!enviando) void crearDescartable();
            }}
          >
            <label className="campo">
              <span className="campo__etiqueta">Nombre</span>
              <input
                className="campo__control"
                value={ndNombre}
                onChange={(e) => setNdNombre(e.target.value)}
                placeholder="Ej: Sutura Vicryl 3-0"
                maxLength={120}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Código</span>
              <input
                className="campo__control"
                value={ndCodigo}
                onChange={(e) => setNdCodigo(e.target.value.toUpperCase())}
                placeholder="Ej: STURA-VICRYL-30"
                maxLength={32}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Unidad</span>
              <input
                className="campo__control"
                value={ndUnidad}
                onChange={(e) => setNdUnidad(e.target.value)}
                placeholder="Ej: caja, unidad, rollo"
                maxLength={20}
              />
            </label>

            <label className="campo">
              <span className="campo__etiqueta">Punto de reposición (mínimo en stock)</span>
              <input
                className="campo__control"
                type="number"
                min="0"
                value={ndPunto}
                onChange={(e) => setNdPunto(e.target.value)}
              />
            </label>

            <button
              type="submit"
              className="boton boton--primario"
              disabled={!ndNombre.trim() || !ndCodigo.trim() || !ndUnidad.trim() || enviando}
            >
              {enviando ? 'Creando...' : 'Crear descartable'}
            </button>
          </form>
        </section>
      )}

      {tab === 'movimiento' && movimientoDescartable && (
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Ajuste / Devolución de stock</h2>
          <p className="sutil" style={{ marginBottom: '1rem' }}>
            Descartable: <strong>{movimientoDescartable.nombre}</strong> ({movimientoDescartable.codigo})
          </p>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              if (!enviando) void registrarMovimiento();
            }}
          >
            <div className="formulario__fila">
              <label className="campo" style={{ flex: 2 }}>
                <span className="campo__etiqueta">Lote</span>
                <select
                  className="campo__control"
                  value={movLoteId}
                  onChange={(e) => setMovLoteId(e.target.value)}
                  required
                >
                  <option value="">Seleccionar lote...</option>
                  {movLotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.numeroLote} (Actual: {l.cantidadActual})
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo" style={{ flex: 1 }}>
                <span className="campo__etiqueta">Tipo</span>
                <select
                  className="campo__control"
                  value={movTipo}
                  onChange={(e) => setMovTipo(e.target.value as any)}
                >
                  <option value="ajuste">Ajuste (+ / -)</option>
                  <option value="devolucion">Devolución (+)</option>
                  <option value="vencido">Baja por vencimiento (-)</option>
                </select>
              </label>
            </div>

            <div className="formulario__fila">
              <label className="campo">
                <span className="campo__etiqueta">Cantidad</span>
                <input
                  className="campo__control"
                  type="number"
                  value={movCantidad}
                  onChange={(e) => setMovCantidad(e.target.value)}
                  required
                  placeholder={movTipo === 'ajuste' ? 'Ej: -2 o 5' : 'Ej: 3'}
                />
              </label>
              <label className="campo" style={{ flex: 2 }}>
                <span className="campo__etiqueta">Motivo (opcional)</span>
                <input
                  className="campo__control"
                  type="text"
                  value={movMotivo}
                  onChange={(e) => setMovMotivo(e.target.value)}
                  maxLength={150}
                  placeholder="Razón del movimiento"
                />
              </label>
            </div>

            <button type="submit" className="boton boton--primario" disabled={!movLoteId || !movCantidad || enviando}>
              {enviando ? 'Guardando...' : 'Registrar movimiento'}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
