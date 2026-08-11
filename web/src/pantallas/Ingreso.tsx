import { useEffect, useState } from 'react';

import { ErrorApi, pedir, SinRed } from '../lib/api';
import { guardarMeta, leerMeta } from '../lib/almacen';
import { guardarSesion, type UsuarioSesion } from '../lib/sesion';
import { habilitarSonido } from '../lib/sonido';

interface Props {
  onIngreso: (usuario: UsuarioSesion) => void;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const;

/**
 * Ingreso por PIN.
 *
 * Primero se elige el usuario y despues se tipea el PIN. Nunca al reves: sin
 * usuario elegido habria que buscar "quien tiene este PIN", y con cuatro
 * digitos las colisiones son cuestion de tiempo.
 *
 * El teclado es de botones grandes porque esto se usa con guantes.
 */
export function Ingreso({ onIngreso }: Props) {
  const [usuarios, setUsuarios] = useState<UsuarioSesion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegido, setElegido] = useState<UsuarioSesion | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const lista = await pedir<UsuarioSesion[]>('/api/usuarios', { conSesion: false });
        setUsuarios(lista);
        await guardarMeta('usuarios', lista);
      } catch {
        // Sin señal se muestra la ultima lista conocida: al menos se ve quien
        // trabaja aca, aunque el PIN no se pueda verificar hasta tener red.
        const guardados = await leerMeta<UsuarioSesion[]>('usuarios');
        if (guardados) setUsuarios(guardados);
        setError('Sin conexion: hace falta señal para ingresar.');
      } finally {
        // Sin esto, una lista vacia se ve igual que una que todavia no llego:
        // la pantalla queda diciendo "cargando" para siempre y nadie entiende
        // que el sistema no tiene usuarios dados de alta.
        setCargando(false);
      }
    })();
  }, []);

  const ingresar = async (pinCompleto: string): Promise<void> => {
    if (!elegido) return;
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await pedir<{ token: string; usuario: UsuarioSesion }>('/api/sesion', {
        metodo: 'POST',
        conSesion: false,
        cuerpo: { usuarioId: elegido.id, pin: pinCompleto },
      });
      guardarSesion(respuesta);
      habilitarSonido();
      onIngreso(respuesta.usuario);
    } catch (problema) {
      setPin('');
      if (problema instanceof SinRed) {
        setError('Sin conexion: no se puede verificar el PIN.');
      } else if (problema instanceof ErrorApi && problema.estado === 429) {
        setError('Demasiados intentos. Esperar unos minutos antes de reintentar.');
      } else if (problema instanceof ErrorApi) {
        const restantes = (problema.cuerpo as { intentosRestantes?: number })?.intentosRestantes;
        setError(
          restantes !== undefined
            ? `PIN incorrecto. Quedan ${restantes} ${restantes === 1 ? 'intento' : 'intentos'}.`
            : 'PIN incorrecto.',
        );
      } else {
        setError('No se pudo ingresar.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const tocar = (tecla: string): void => {
    habilitarSonido();
    if (tecla === 'borrar') {
      setPin((actual) => actual.slice(0, -1));
      return;
    }
    if (tecla === 'ok') {
      if (pin.length >= 4) void ingresar(pin);
      return;
    }
    setPin((actual) => (actual.length >= 6 ? actual : actual + tecla));
  };

  if (!elegido) {
    return (
      <main className="pantalla pantalla--centrada">
        <h1 className="titulo">Quien sos</h1>
        {error && <p className="aviso aviso--error">{error}</p>}
        <ul className="lista-usuarios">
          {usuarios.map((usuario) => (
            <li key={usuario.id}>
              <button
                type="button"
                className="usuario"
                onClick={() => {
                  setElegido(usuario);
                  setError(null);
                }}
              >
                <span className="usuario__nombre">{usuario.nombre}</span>
                <span className="usuario__rol">{usuario.rol}</span>
              </button>
            </li>
          ))}
        </ul>
        {cargando && <p className="sutil">Cargando usuarios...</p>}

        {!cargando && usuarios.length === 0 && !error && (
          <div className="aviso aviso--atencion">
            <strong>Todavia no hay usuarios cargados</strong>
            <p>
              El sistema esta funcionando, pero nadie puede entrar hasta que se den de alta las
              personas que lo van a usar.
            </p>
            <p className="aviso__nota">
              Se cargan desde la administracion del sistema, con un PIN por persona.
            </p>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="pantalla pantalla--centrada">
      <button
        type="button"
        className="boton boton--texto"
        onClick={() => {
          setElegido(null);
          setPin('');
          setError(null);
        }}
      >
        &larr; Cambiar de usuario
      </button>

      <h1 className="titulo">{elegido.nombre}</h1>
      <p className="sutil">Ingresa tu PIN</p>

      <div className="pin" aria-label={`PIN de ${pin.length} digitos`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`pin__punto ${i < pin.length ? 'pin__punto--lleno' : ''}`} />
        ))}
      </div>

      {error && <p className="aviso aviso--error">{error}</p>}

      <div className="teclado">
        {TECLAS.map((tecla) => (
          <button
            key={tecla}
            type="button"
            className={`tecla ${tecla === 'ok' ? 'tecla--ok' : ''} ${tecla === 'borrar' ? 'tecla--borrar' : ''}`}
            onClick={() => tocar(tecla)}
            disabled={enviando || (tecla === 'ok' && pin.length < 4)}
          >
            {tecla === 'borrar' ? '⌫' : tecla === 'ok' ? 'Entrar' : tecla}
          </button>
        ))}
      </div>
    </main>
  );
}
