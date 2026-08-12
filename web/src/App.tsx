import { useCallback, useEffect, useState } from 'react';

import { pedir } from './lib/api';
import { contarPendientes, conflictos as leerConflictos } from './lib/cola';
import { borrarSesion, leerSesion, type UsuarioSesion } from './lib/sesion';
import { Layout } from './componentes/Layout';
import { Cajas } from './pantallas/Cajas';
import { Catalogos } from './pantallas/Catalogos';
import { Ciclos } from './pantallas/Ciclos';
import { Cirugias } from './pantallas/Cirugias';
import { ConfiguracionInicial } from './pantallas/ConfiguracionInicial';
import { Conflictos } from './pantallas/Conflictos';
import { Escaneo } from './pantallas/Escaneo';
import { Ingreso } from './pantallas/Ingreso';
import { Reportes } from './pantallas/Reportes';
import { Stock } from './pantallas/Stock';
import { Usuarios } from './pantallas/Usuarios';

type Pantalla =
  | 'escaneo'
  | 'conflictos'
  | 'usuarios'
  | 'cajas'
  | 'catalogos'
  | 'ciclos'
  | 'stock'
  | 'cirugias'
  | 'reportes';

export function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(() => leerSesion()?.usuario ?? null);
  const [pantalla, setPantalla] = useState<Pantalla>('escaneo');
  const [conflictos, setConflictos] = useState(0);
  const [avisoSalida, setAvisoSalida] = useState<number | null>(null);
  const [requiereConfiguracion, setRequiereConfiguracion] = useState<boolean | null>(null);

  const contarConflictos = useCallback(async () => {
    setConflictos((await leerConflictos()).length);
  }, []);

  useEffect(() => {
    void contarConflictos();
  }, [contarConflictos, usuario]);

  useEffect(() => {
    if (usuario) return;
    void (async () => {
      try {
        const estado = await pedir<{ requiereConfiguracion: boolean }>('/api/setup', {
          conSesion: false,
        });
        setRequiereConfiguracion(estado.requiereConfiguracion);
      } catch {
        setRequiereConfiguracion(false);
      }
    })();
  }, [usuario]);

  const salir = useCallback(async () => {
    const sinSincronizar = await contarPendientes();
    if (sinSincronizar > 0 && avisoSalida === null) {
      setAvisoSalida(sinSincronizar);
      return;
    }
    borrarSesion();
    setAvisoSalida(null);
    setUsuario(null);
    setRequiereConfiguracion(null);
  }, [avisoSalida]);

  /* ── Sin sesión ── */
  if (!usuario) {
    if (requiereConfiguracion === null) {
      return (
        <main className="pantalla pantalla--centrada">
          <p className="sutil">Cargando...</p>
        </main>
      );
    }
    if (requiereConfiguracion) return <ConfiguracionInicial onListo={setUsuario} />;
    return <Ingreso onIngreso={setUsuario} />;
  }

  /* ── Aviso de cola antes de salir ── */
  if (avisoSalida !== null) {
    return (
      <main className="pantalla pantalla--centrada">
        <h1 className="titulo">Quedan escaneos sin subir</h1>
        <p className="aviso aviso--atencion">
          Hay {avisoSalida} {avisoSalida === 1 ? 'escaneo' : 'escaneos'} en la cola de este
          dispositivo. Solo los puede sincronizar {usuario.nombre}: si cerrás la sesión ahora, van a
          quedar esperando hasta que vuelvas a ingresar.
        </p>
        <div className="acciones">
          <button type="button" className="boton boton--primario" onClick={() => setAvisoSalida(null)}>
            Volver y sincronizar
          </button>
          <button type="button" className="boton boton--secundario" onClick={() => void salir()}>
            Cerrar sesión igual
          </button>
        </div>
      </main>
    );
  }

  const ir = (p: Pantalla) => () => setPantalla(p);
  const volver = ir('escaneo');

  /* ── Pantalla activa ── */
  const renderPantalla = () => {
    switch (pantalla) {
      case 'conflictos':
        return <Conflictos onVolver={volver} onCambiaron={() => void contarConflictos()} />;
      case 'usuarios':
        return <Usuarios onVolver={volver} usuarioActual={usuario.id} />;
      case 'cajas':
        return <Cajas onVolver={volver} />;
      case 'catalogos':
        return <Catalogos onVolver={volver} />;
      case 'ciclos':
        return <Ciclos onVolver={volver} rol={usuario.rol} />;
      case 'stock':
        return <Stock onVolver={volver} />;
      case 'cirugias':
        return <Cirugias onVolver={volver} />;
      case 'reportes':
        return <Reportes onVolver={volver} />;
      default:
        return (
          <Escaneo
            usuario={usuario}
            conflictos={conflictos}
            onVerConflictos={ir('conflictos')}
            onConflictosCambiaron={() => void contarConflictos()}
            onSesionVencida={() => {
              borrarSesion();
              setUsuario(null);
              setRequiereConfiguracion(null);
            }}
          />
        );
    }
  };

  return (
    <Layout
      usuario={usuario}
      pantallaActual={pantalla}
      onNavegar={setPantalla}
      onSalir={() => void salir()}
    >
      {renderPantalla()}
    </Layout>
  );
}
