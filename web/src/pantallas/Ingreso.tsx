import { useEffect, useState } from 'react';

import { ErrorApi, pedir, SinRed } from '../lib/api';
import { guardarMeta, leerMeta } from '../lib/almacen';
import { guardarSesion, type UsuarioSesion } from '../lib/sesion';
import { habilitarSonido } from '../lib/sonido';

interface Props {
  onIngreso: (usuario: UsuarioSesion) => void;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const;

const ROLES_ES: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  instrumentadora: 'Instrumentadora',
  esterilizacion: 'Esterilización',
  medico: 'Médico',
};

function iniciales(nombre: string): string {
  return nombre.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

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
        const guardados = await leerMeta<UsuarioSesion[]>('usuarios');
        if (guardados) setUsuarios(guardados);
        setError('Sin conexión: hace falta señal para ingresar.');
      } finally {
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
        setError('Sin conexión: no se puede verificar el PIN.');
      } else if (problema instanceof ErrorApi && problema.estado === 429) {
        setError('Demasiados intentos. Esperá unos minutos.');
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
    if (tecla === 'borrar') { setPin((a) => a.slice(0, -1)); return; }
    if (tecla === 'ok') { if (pin.length >= 4) void ingresar(pin); return; }
    setPin((a) => (a.length >= 6 ? a : a + tecla));
  };

  return (
    <div className="login-layout">
      {/* Panel izquierdo — branding */}
      <div className="login-brand">
        <div className="login-brand__inner">
          <div className="login-brand__logo">
            <span className="login-brand__icon">⚕️</span>
            <div>
              <div className="login-brand__name">Instrumental</div>
              <div className="login-brand__tagline">Gestión quirúrgica</div>
            </div>
          </div>
          <div className="login-brand__body">
            <h1 className="login-brand__heading">
              Trazabilidad<br />de nivel médico.
            </h1>
            <p className="login-brand__sub">
              Control de cajas, ciclos de esterilización, stock de descartables y trazabilidad completa por cirugía.
            </p>
          </div>
          <div className="login-brand__pills">
            <span className="login-pill">📷 Escaneo offline</span>
            <span className="login-pill">♻️ Esterilización</span>
            <span className="login-pill">📊 Trazabilidad</span>
          </div>
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="login-form-panel">
        <div className="login-card">
          {!elegido ? (
            <>
              <div className="login-card__header">
                <h2 className="login-card__title">Seleccioná tu usuario</h2>
                <p className="login-card__sub">Después vas a ingresar tu PIN</p>
              </div>

              {error && <p className="aviso aviso--error" style={{ marginBottom: '1rem' }}>{error}</p>}

              {cargando ? (
                <div className="login-skeleton">
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                </div>
              ) : usuarios.length === 0 && !error ? (
                <div className="aviso aviso--atencion">
                  <strong>Sin usuarios</strong>
                  <p>El sistema está activo, pero no hay usuarios cargados todavía.</p>
                </div>
              ) : (
                <ul className="login-users">
                  {usuarios.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className="login-user"
                        onClick={() => { setElegido(u); setError(null); }}
                      >
                        <div className="login-user__avatar">{iniciales(u.nombre)}</div>
                        <div className="login-user__info">
                          <span className="login-user__name">{u.nombre}</span>
                          <span className="login-user__role">{ROLES_ES[u.rol] ?? u.rol}</span>
                        </div>
                        <span className="login-user__arrow">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="login-card__header">
                <button
                  type="button"
                  className="login-back"
                  onClick={() => { setElegido(null); setPin(''); setError(null); }}
                >
                  ← Volver
                </button>
                <div className="login-who">
                  <div className="login-who__avatar">{iniciales(elegido.nombre)}</div>
                  <div>
                    <div className="login-who__name">{elegido.nombre}</div>
                    <div className="login-who__role">{ROLES_ES[elegido.rol] ?? elegido.rol}</div>
                  </div>
                </div>
                <p className="login-card__sub">Ingresá tu PIN</p>
              </div>

              <div className="pin-display">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className={`pin-dot ${i < pin.length ? 'pin-dot--filled' : ''}`} />
                ))}
              </div>

              {error && <p className="aviso aviso--error" style={{ margin: '0 0 0.75rem' }}>{error}</p>}

              <div className="pin-pad">
                {TECLAS.map((tecla) => (
                  <button
                    key={tecla}
                    type="button"
                    className={`pin-key ${tecla === 'ok' ? 'pin-key--ok' : ''} ${tecla === 'borrar' ? 'pin-key--del' : ''}`}
                    onClick={() => tocar(tecla)}
                    disabled={enviando || (tecla === 'ok' && pin.length < 4)}
                  >
                    {tecla === 'borrar' ? '⌫' : tecla === 'ok' ? (enviando ? '...' : 'Entrar') : tecla}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
