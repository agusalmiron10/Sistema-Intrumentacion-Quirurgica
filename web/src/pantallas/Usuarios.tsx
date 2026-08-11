import { useEffect, useState } from 'react';

import { ErrorApi, pedir } from '../lib/api';

interface Props {
  onVolver: () => void;
  usuarioActual: string;
}

interface UsuarioAdmin {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: number;
  bloqueadoHasta: string | null;
}

const ROLES: { valor: string; etiqueta: string; descripcion: string }[] = [
  {
    valor: 'instrumentadora',
    etiqueta: 'Instrumentadora',
    descripcion: 'Escanea cajas y prepara cirugias',
  },
  {
    valor: 'esterilizacion',
    etiqueta: 'Esterilizacion',
    descripcion: 'Arma ciclos y carga controles',
  },
  {
    valor: 'supervisor',
    etiqueta: 'Supervisor',
    descripcion: 'Todo lo anterior y ademas libera lotes',
  },
  { valor: 'admin', etiqueta: 'Administracion', descripcion: 'Administra usuarios y catalogos' },
];

/** Alta y administracion de usuarios. Solo la ve un administrador. */
export function Usuarios({ onVolver, usuarioActual }: Props) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState('instrumentadora');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const recargar = async (): Promise<void> => {
    try {
      setUsuarios(await pedir<UsuarioAdmin[]>('/api/admin/usuarios'));
    } catch (problema) {
      setError(problema instanceof ErrorApi ? problema.message : 'No se pudo cargar la lista');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void recargar();
  }, []);

  const pinValido = /^\d{4,6}$/.test(pin);
  const completo = nombre.trim() !== '' && email.trim() !== '' && pinValido;

  const crear = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      await pedir('/api/admin/usuarios', {
        metodo: 'POST',
        cuerpo: { nombre: nombre.trim(), email: email.trim(), rol, pin },
      });
      setExito(`${nombre.trim()} quedo dado de alta. Pasale el PIN en persona.`);
      setNombre('');
      setEmail('');
      setPin('');
      await recargar();
    } catch (problema) {
      setError(
        problema instanceof ErrorApi && problema.estado === 409
          ? 'Ya hay un usuario con ese email'
          : problema instanceof ErrorApi
            ? problema.message
            : 'No se pudo crear el usuario',
      );
    } finally {
      setEnviando(false);
    }
  };

  const cambiar = async (id: string, cambios: Record<string, unknown>): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      await pedir(`/api/admin/usuarios/${id}`, { metodo: 'PATCH', cuerpo: cambios });
      await recargar();
    } catch (problema) {
      setError(problema instanceof ErrorApi ? problema.message : 'No se pudo actualizar');
    }
  };

  const blanquearPin = async (usuario: UsuarioAdmin): Promise<void> => {
    const nuevo = window.prompt(`PIN nuevo para ${usuario.nombre} (4 a 6 digitos)`);
    if (nuevo === null) return;
    if (!/^\d{4,6}$/.test(nuevo)) {
      setError('El PIN son 4 a 6 digitos');
      return;
    }
    await cambiar(usuario.id, { pin: nuevo });
    setExito(`PIN de ${usuario.nombre} cambiado. Pasaselo en persona.`);
  };

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Usuarios</h1>
          <p className="sutil">Quien puede entrar al sistema y con que permisos</p>
        </div>
        <button type="button" className="boton boton--texto" onClick={onVolver}>
          Volver
        </button>
      </header>

      {error && <p className="aviso aviso--error">{error}</p>}
      {exito && <p className="aviso aviso--ok">{exito}</p>}

      <section className="tarjeta">
        <h2 className="tarjeta__titulo">Dar de alta</h2>
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault();
            if (completo && !enviando) void crear();
          }}
        >
          <label className="campo">
            <span className="campo__etiqueta">Nombre y apellido</span>
            <input
              className="campo__control"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
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
              maxLength={160}
            />
          </label>

          <fieldset className="campo campo--roles">
            <legend className="campo__etiqueta">Rol</legend>
            {ROLES.map((r) => (
              <label key={r.valor} className={`rol ${rol === r.valor ? 'rol--elegido' : ''}`}>
                <input
                  type="radio"
                  name="rol"
                  value={r.valor}
                  checked={rol === r.valor}
                  onChange={() => setRol(r.valor)}
                />
                <span>
                  <strong>{r.etiqueta}</strong>
                  <span className="rol__descripcion">{r.descripcion}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="campo">
            <span className="campo__etiqueta">PIN inicial (4 a 6 digitos)</span>
            <input
              className="campo__control"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <span className="campo__ayuda">
              Se lo pasas en persona. El PIN no queda guardado en ningun lado: solo su hash.
            </span>
          </label>

          <button type="submit" className="boton boton--primario" disabled={!completo || enviando}>
            {enviando ? 'Creando...' : 'Dar de alta'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="tarjeta__titulo">Equipo</h2>
        {cargando && <p className="sutil">Cargando...</p>}

        <ul className="lista-admin">
          {usuarios.map((usuario) => (
            <li key={usuario.id} className={`admin ${usuario.activo === 0 ? 'admin--baja' : ''}`}>
              <div className="admin__datos">
                <strong>
                  {usuario.nombre}
                  {usuario.id === usuarioActual && <span className="admin__vos"> (vos)</span>}
                </strong>
                <span className="sutil">{usuario.email}</span>
                <span className="admin__rol">
                  {ROLES.find((r) => r.valor === usuario.rol)?.etiqueta ?? usuario.rol}
                </span>
                {usuario.activo === 0 && <span className="admin__estado">dado de baja</span>}
                {usuario.bloqueadoHasta && (
                  <span className="admin__estado">bloqueado por intentos fallidos</span>
                )}
              </div>

              <div className="admin__acciones">
                <select
                  className="campo__control campo__control--chico"
                  value={usuario.rol}
                  onChange={(e) => void cambiar(usuario.id, { rol: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.etiqueta}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void blanquearPin(usuario)}
                >
                  Cambiar PIN
                </button>

                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void cambiar(usuario.id, { activo: usuario.activo === 0 })}
                >
                  {usuario.activo === 0 ? 'Reactivar' : 'Dar de baja'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
