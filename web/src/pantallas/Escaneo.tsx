import { useCallback, useEffect, useRef, useState } from 'react';

import { CamaraDiferida } from '../componentes/CamaraDiferida';
import { EntradaManual } from '../componentes/EntradaManual';
import { IndicadorSync } from '../componentes/IndicadorSync';
import { aplicarOptimista, legible, resolver, sincronizarCatalogo, validarLocalmente } from '../lib/cajas';
import { contarPendientes, encolar, sincronizar } from '../lib/cola';
import { OPERACIONES, type Operacion } from '../lib/operaciones';
import type { UsuarioSesion } from '../lib/sesion';
import { sonarError, sonarOk, sonarRepetido } from '../lib/sonido';

interface Props {
  usuario: UsuarioSesion;
  conflictos: number;
  onVerConflictos: () => void;
  onConflictosCambiaron: () => void;
  onSalir: () => void;
  onSesionVencida: () => void;
}

interface Escaneado {
  clave: string;
  codigo: string;
  nombre: string;
  resultado: 'encolado' | 'rechazado' | 'repetido';
  detalle?: string;
}

const SEGUNDOS_ENTRE_SYNC = 30;

export function Escaneo({
  usuario,
  conflictos,
  onVerConflictos,
  onConflictosCambiaron,
  onSalir,
  onSesionVencida,
}: Props) {
  const [operacion, setOperacion] = useState<Operacion | null>(null);
  const [tanda, setTanda] = useState<Escaneado[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // La operacion se lee desde el callback del escaneo, que es estable para no
  // reiniciar la camara. Por eso vive tambien en un ref.
  const operacionActual = useRef<Operacion | null>(null);
  operacionActual.current = operacion;
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

  if (!operacion) {
    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <p className="sutil">{usuario.nombre}</p>
            <h1 className="titulo">Que estas haciendo</h1>
          </div>
          <button type="button" className="boton boton--texto" onClick={onSalir}>
            Salir
          </button>
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
                onClick={() => {
                  yaEnTanda.current = new Set();
                  setTanda([]);
                  setAviso(null);
                  setOperacion(op);
                }}
              >
                <span className="operacion__etiqueta">{op.etiqueta}</span>
                <span className="operacion__descripcion">{op.descripcion}</span>
                {op.pendienteDeFase && (
                  <span className="operacion__pendiente">{op.pendienteDeFase}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const encolados = tanda.filter((t) => t.resultado === 'encolado').length;

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
