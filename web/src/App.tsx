import { useCallback, useEffect, useState } from 'react';

import { contarPendientes, conflictos as leerConflictos } from './lib/cola';
import { borrarSesion, leerSesion, type UsuarioSesion } from './lib/sesion';
import { Conflictos } from './pantallas/Conflictos';
import { Escaneo } from './pantallas/Escaneo';
import { Ingreso } from './pantallas/Ingreso';

type Pantalla = 'escaneo' | 'conflictos';

export function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(() => leerSesion()?.usuario ?? null);
  const [pantalla, setPantalla] = useState<Pantalla>('escaneo');
  const [conflictos, setConflictos] = useState(0);
  const [avisoSalida, setAvisoSalida] = useState<number | null>(null);

  const contarConflictos = useCallback(async () => {
    setConflictos((await leerConflictos()).length);
  }, []);

  useEffect(() => {
    void contarConflictos();
  }, [contarConflictos, usuario]);

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
  }, [avisoSalida]);

  if (!usuario) {
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

  return (
    <Escaneo
      usuario={usuario}
      conflictos={conflictos}
      onVerConflictos={() => setPantalla('conflictos')}
      onConflictosCambiaron={() => void contarConflictos()}
      onSalir={() => void salir()}
      onSesionVencida={() => {
        borrarSesion();
        setUsuario(null);
      }}
    />
  );
}
