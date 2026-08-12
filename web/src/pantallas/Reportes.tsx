import { useState } from 'react';

import { pedir } from '../lib/api';
import { leerSesion } from '../lib/sesion';

interface Props {
  onVolver: () => void;
}

interface Caja {
  id: string;
  codigo: string;
  nombre: string;
}

interface Cirugia {
  id: string;
  pacienteRef: string;
  programadaPara: string;
  procedimientoNombre?: string;
}

/** Pantalla de reportes Excel y etiquetas PDF. */
export function Reportes({ onVolver }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  // Para reporte de caja específica
  const [cajaRef, setCajaRef] = useState('');
  const [cirugiaId, setCirugiaId] = useState('');

  // Para etiquetas
  const [etiquetaRefs, setEtiquetaRefs] = useState('');
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cirugiasLista, setCirugiasLista] = useState<Cirugia[]>([]);

  // Cargar listas al montar
  const cargarListas = async (): Promise<void> => {
    try {
      const [listaCajas, listaCirugias] = await Promise.all([
        pedir<Caja[]>('/api/cajas'),
        pedir<Cirugia[]>('/api/cirugias?limite=100'),
      ]);
      setCajas(listaCajas);
      setCirugiasLista(listaCirugias);
    } catch {
      // silencioso, no es crítico
    }
  };

  useState(() => {
    void cargarListas();
  });

  const descargar = async (nombre: string, url: string, tipo: string): Promise<void> => {
    setDescargando(nombre);
    setError(null);
    try {
      const sesion = leerSesion();
      const cabeceras: Record<string, string> = {};
      if (sesion) cabeceras['Authorization'] = `Bearer ${sesion.token}`;

      const resp = await fetch(url, { headers: cabeceras });
      if (!resp.ok) {
        const texto = await resp.text();
        let mensaje = `Error ${resp.status}`;
        try {
          mensaje = (JSON.parse(texto) as { mensaje?: string }).mensaje ?? mensaje;
        } catch {}
        throw new Error(mensaje);
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (p) {
      setError(p instanceof Error ? p.message : `No se pudo descargar ${tipo}`);
    } finally {
      setDescargando(null);
    }
  };

  const descargarEtiquetas = async (): Promise<void> => {
    const refs = etiquetaRefs
      .split(/[\n,;]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (refs.length === 0) {
      setError('Ingresá al menos un código de caja.');
      return;
    }

    setDescargando('etiquetas');
    setError(null);
    try {
      const sesion = leerSesion();
      const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sesion) cabeceras['Authorization'] = `Bearer ${sesion.token}`;

      const resp = await fetch('/api/etiquetas', {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify({ refs }),
      });

      if (!resp.ok) {
        const texto = await resp.text();
        let mensaje = `Error ${resp.status}`;
        try {
          mensaje = (JSON.parse(texto) as { mensaje?: string }).mensaje ?? mensaje;
        } catch {}
        throw new Error(mensaje);
      }

      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (p) {
      setError(p instanceof Error ? p.message : 'No se pudo generar el PDF');
    } finally {
      setDescargando(null);
    }
  };

  const fecha = new Date().toISOString().slice(0, 10);

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Reportes</h1>
          <p className="sutil">Exportación a Excel y pliego de etiquetas QR</p>
        </div>
        <button type="button" className="boton boton--texto" onClick={onVolver}>
          Volver
        </button>
      </header>

      {error && <p className="aviso aviso--error">{error}</p>}

      {/* Etiquetas PDF */}
      <section className="tarjeta">
        <h2 className="tarjeta__titulo">🏷 Etiquetas QR (PDF)</h2>
        <p className="sutil" style={{ marginBottom: '0.75rem' }}>
          Genera un pliego listo para imprimir con los QR de las cajas seleccionadas.
        </p>
        <div className="formulario">
          <label className="campo">
            <span className="campo__etiqueta">Códigos de cajas (uno por línea o separados por coma)</span>
            <textarea
              className="campo__control"
              value={etiquetaRefs}
              onChange={(e) => setEtiquetaRefs(e.target.value)}
              rows={4}
              placeholder={'LAP-01\nLAP-02\nORTO-05'}
            />
          </label>
          {cajas.length > 0 && (
            <button
              type="button"
              className="boton boton--secundario boton--chico"
              onClick={() => setEtiquetaRefs(cajas.map((c) => c.codigo).join('\n'))}
            >
              Todas las cajas
            </button>
          )}
          <button
            type="button"
            className="boton boton--primario"
            disabled={descargando !== null}
            onClick={() => void descargarEtiquetas()}
          >
            {descargando === 'etiquetas' ? 'Generando...' : 'Descargar PDF'}
          </button>
        </div>
      </section>

      {/* Reportes Excel */}
      <section className="tarjeta">
        <h2 className="tarjeta__titulo">📊 Stock de descartables</h2>
        <p className="sutil" style={{ marginBottom: '0.75rem' }}>
          Existencias actuales, lotes y alertas de reposición.
        </p>
        <button
          type="button"
          className="boton boton--primario"
          disabled={descargando !== null}
          onClick={() =>
            void descargar(
              `stock-${fecha}.xlsx`,
              '/api/reportes/stock',
              'stock',
            )
          }
        >
          {descargando === `stock-${fecha}.xlsx` ? 'Descargando...' : 'Descargar Excel de stock'}
        </button>
      </section>

      <section className="tarjeta">
        <h2 className="tarjeta__titulo">📊 Productividad de ciclos</h2>
        <p className="sutil" style={{ marginBottom: '0.75rem' }}>
          Ciclos de esterilización: cajas procesadas, controles y tiempos.
        </p>
        <button
          type="button"
          className="boton boton--primario"
          disabled={descargando !== null}
          onClick={() =>
            void descargar(
              `ciclos-${fecha}.xlsx`,
              '/api/reportes/ciclos',
              'ciclos',
            )
          }
        >
          {descargando === `ciclos-${fecha}.xlsx` ? 'Descargando...' : 'Descargar Excel de ciclos'}
        </button>
      </section>

      <section className="tarjeta">
        <h2 className="tarjeta__titulo">📊 Historial de una caja</h2>
        <p className="sutil" style={{ marginBottom: '0.75rem' }}>
          Todos los movimientos de una caja: desde qué estado, hacia cuál, quién y cuándo.
        </p>
        <div className="formulario">
          <label className="campo">
            <span className="campo__etiqueta">Código o ID de la caja</span>
            <input
              className="campo__control"
              value={cajaRef}
              onChange={(e) => setCajaRef(e.target.value)}
              placeholder="Ej: LAP-02"
              list="cajas-list"
            />
            <datalist id="cajas-list">
              {cajas.map((c) => (
                <option key={c.id} value={c.codigo}>{c.nombre}</option>
              ))}
            </datalist>
          </label>
          <button
            type="button"
            className="boton boton--primario"
            disabled={!cajaRef.trim() || descargando !== null}
            onClick={() =>
              void descargar(
                `historial-${cajaRef.trim()}-${fecha}.xlsx`,
                `/api/reportes/cajas/${encodeURIComponent(cajaRef.trim())}`,
                'historial de caja',
              )
            }
          >
            {descargando?.startsWith('historial-') ? 'Descargando...' : 'Descargar Excel'}
          </button>
        </div>
      </section>

      <section className="tarjeta">
        <h2 className="tarjeta__titulo">📊 Trazabilidad de cirugía</h2>
        <p className="sutil" style={{ marginBottom: '0.75rem' }}>
          Cajas usadas, ciclos y lotes consumidos en una cirugía específica.
        </p>
        <div className="formulario">
          <label className="campo">
            <span className="campo__etiqueta">Seleccioná la cirugía</span>
            <select
              className="campo__control"
              value={cirugiaId}
              onChange={(e) => setCirugiaId(e.target.value)}
            >
              <option value="">Seleccionar cirugía...</option>
              {cirugiasLista.map((c) => (
                <option key={c.id} value={c.id}>
                  {new Date(c.programadaPara).toLocaleDateString('es-AR')} - Pac. {c.pacienteRef}
                  {c.procedimientoNombre ? ` (${c.procedimientoNombre})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="boton boton--primario"
            disabled={!cirugiaId.trim() || descargando !== null}
            onClick={() =>
              void descargar(
                `trazabilidad-cirugia-${cirugiaId.trim().slice(-8)}-${fecha}.xlsx`,
                `/api/reportes/cirugias/${encodeURIComponent(cirugiaId.trim())}`,
                'trazabilidad',
              )
            }
          >
            {descargando?.startsWith('trazabilidad-') ? 'Descargando...' : 'Descargar Excel'}
          </button>
        </div>
      </section>
    </main>
  );
}
