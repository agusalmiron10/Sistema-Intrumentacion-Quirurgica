import { useState } from 'react';

import { ErrorApi, pedir, SinRed } from '../lib/api';
import { guardarSesion, type UsuarioSesion } from '../lib/sesion';
import { habilitarSonido } from '../lib/sonido';

interface Props {
  onListo: (usuario: UsuarioSesion) => void;
}

/**
 * Configuracion inicial: crea el primer administrador.
 *
 * Sin esto el sistema queda trabado, porque no se puede entrar sin usuario ni
 * crear un usuario sin entrar. Esta pantalla solo aparece mientras la base no
 * tenga ningun usuario; despues el servidor rechaza el alta.
 */
export function ConfiguracionInicial({ onListo }: Props) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [repetido, setRepetido] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const pinValido = /^\d{4,6}$/.test(pin);
  const coinciden = pin === repetido;
  const completo = nombre.trim() !== '' && email.trim() !== '' && pinValido && coinciden;

  const enviar = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await pedir<{ token: string; usuario: UsuarioSesion }>('/api/setup', {
        metodo: 'POST',
        conSesion: false,
        cuerpo: { nombre: nombre.trim(), email: email.trim(), pin },
      });
      guardarSesion(respuesta);
      habilitarSonido();
      onListo(respuesta.usuario);
    } catch (problema) {
      if (problema instanceof SinRed) {
        setError('Sin conexion con el servidor.');
      } else if (problema instanceof ErrorApi && problema.estado === 409) {
        setError('El sistema ya tiene usuarios. Pedile a un administrador que te de de alta.');
      } else if (problema instanceof ErrorApi) {
        setError(problema.message);
      } else {
        setError('No se pudo crear el usuario.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="pantalla pantalla--centrada">
      <h1 className="titulo">Configuracion inicial</h1>
      <p className="sutil">
        El sistema todavia no tiene usuarios. Crea el primero, que va a quedar como administrador y
        va a poder dar de alta al resto del equipo.
      </p>

      {error && <p className="aviso aviso--error">{error}</p>}

      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (completo && !enviando) void enviar();
        }}
      >
        <label className="campo">
          <span className="campo__etiqueta">Nombre y apellido</span>
          <input
            className="campo__control"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="name"
            maxLength={120}
          />
        </label>

        <label className="campo">
          <span className="campo__etiqueta">Email</span>
          <input
            className="campo__control"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={160}
          />
        </label>

        <label className="campo">
          <span className="campo__etiqueta">PIN (4 a 6 digitos)</span>
          <input
            className="campo__control"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="new-password"
          />
          <span className="campo__ayuda">
            Se usa con guantes y apurada: por eso son digitos y no una contraseña larga. La
            seguridad la da el bloqueo tras cinco intentos fallidos.
          </span>
        </label>

        <label className="campo">
          <span className="campo__etiqueta">Repetir el PIN</span>
          <input
            className="campo__control"
            type="password"
            inputMode="numeric"
            value={repetido}
            onChange={(e) => setRepetido(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="new-password"
          />
          {repetido !== '' && !coinciden && (
            <span className="campo__error">Los dos PIN no coinciden</span>
          )}
        </label>

        <button type="submit" className="boton boton--primario" disabled={!completo || enviando}>
          {enviando ? 'Creando...' : 'Crear administrador'}
        </button>
      </form>
    </main>
  );
}
