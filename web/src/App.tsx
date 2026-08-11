import { useCallback, useEffect, useState } from 'react';

import { pedir } from './lib/api';
import { contarPendientes, conflictos as leerConflictos } from './lib/cola';
import { borrarSesion, leerSesion, type UsuarioSesion } from './lib/sesion';
import { ConfiguracionInicial } from './pantallas/ConfiguracionInicial';
import { Conflictos } from './pantallas/Conflictos';
import { Escaneo } from './pantallas/Escaneo';
import { Ingreso } from './pantallas/Ingreso';
import { Usuarios } from './pantallas/Usuarios';

type Pantalla = 'escaneo' | 'conflictos' | 'usuarios';

export function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(() => leerSesion()?.usuario ?? null);
  const [pantalla, setPantalla] = useState<Pantalla>('escaneo');
  const [conflictos, setConflictos] = useState(0);
  const [avisoSalida, setAvisoSalida] = useState<number | null>(null);

  /** null = todavia no sabemos si el sistema esta configurado. */
  const [requiereConfiguracion, setRequiereConfiguracion] = useState<boolean | null>(null);

  const contarConflictos = useCallback(async () => {
    setConflictos((await leerConflictos()).length);
  }, []);

  useEffect(() => {
    void contarConflictos();
  }, [contarConflictos, usuario]);

  // Sin sesion hay que averiguar si es la primera vez que se abre el sistema:
  // en ese caso no se pide un usuario que todavia no existe, se lo crea.
  useEffect(() => {
    if (usuario) return;

    void (async () => {
      try {
        const estado = await pedir<{ requiereConfiguracion: boolean }>('/api/setup', {
          conSesion: false,
        });
        setRequiereConfiguracion(estado.requiereConfiguracion);
      } catch {
        // Sin red se asume configurado: la pantalla de ingreso sabe explicar
        // que hace falta señal, y no queremos ofrecer crear un administrador
        // solo porque se cayo la conexion.
        setRequiereConfiguracion(false);
      }
    })();
  }, [usuario]);

  const salir = useCallback(async () => {
    // Cerrar sesion con la cola llena es la forma mas facil de perder trabajo:
    // esos escaneos solo los puede sincronizar quien los hizo.
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

  if (!usuario) {
    if (requiereConfiguracion === null) {
      return (
        <main className="pantalla pantalla--centrada">
          <p className="sutil">Cargando...</p>
        </main>
      );
    }
    if (requiereConfiguracion) {
      return <ConfiguracionInicial onListo={setUsuario} />;
    }
    return <Ingreso onIngreso={setUsuario} />;
  }

  if (avisoSalida !== null) {
    return (
      <main className="pantalla pantalla--centrada">
        <h1 className="titulo">Quedan escaneos sin subir</h1>
        <p className="aviso aviso--atencion">
          Hay {avisoSalida} {avisoSalida === 1 ? 'escaneo' : 'escaneos'} en la cola de este
          dispositivo. Solo los puede sincronizar {usuario.nombre}: si cerras la sesion ahora, van a
          quedar esperando hasta que vuelvas a ingresar.
        </p>
        <div className="acciones">
          <button
            type="button"
            className="boton boton--primario"
            onClick={() => setAvisoSalida(null)}
          >
            Volver y sincronizar
          </button>
          <button type="button" className="boton boton--secundario" onClick={() => void salir()}>
            Cerrar sesion igual
          </button>
        </div>
      </main>
    );
  }

  if (pantalla === 'conflictos') {
    return (
      <Conflictos onVolver={() => setPantalla('escaneo')} onCambiaron={() => void contarConflictos()} />
    );
  }

  if (pantalla === 'usuarios') {
    return <Usuarios onVolver={() => setPantalla('escaneo')} usuarioActual={usuario.id} />;
  }

  return (
    <Escaneo
      usuario={usuario}
      conflictos={conflictos}
      onVerConflictos={() => setPantalla('conflictos')}
      onVerUsuarios={usuario.rol === 'admin' ? () => setPantalla('usuarios') : undefined}
      onConflictosCambiaron={() => void contarConflictos()}
      onSalir={() => void salir()}
      onSesionVencida={() => {
        borrarSesion();
        setUsuario(null);
        setRequiereConfiguracion(null);
      }}
    />
  );
}
