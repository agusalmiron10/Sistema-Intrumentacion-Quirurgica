import type { ReactNode } from 'react';

import type { UsuarioSesion } from '../lib/sesion';

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

interface NavItem {
  id: Pantalla;
  icono: string;
  etiqueta: string;
}

interface Props {
  usuario: UsuarioSesion;
  pantallaActual: Pantalla;
  onNavegar: (p: Pantalla) => void;
  onSalir: () => void;
  children: ReactNode;
}

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

const ROLES_ES: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  instrumentadora: 'Instrumentadora',
  esterilizacion: 'Esterilización',
  medico: 'Médico',
};

/** Layout principal con sidebar en desktop y header en mobile. */
export function Layout({ usuario, pantallaActual, onNavegar, onSalir, children }: Props) {
  const rol = usuario.rol;

  // Qué secciones puede ver cada rol
  const puedeVer = (pantalla: Pantalla): boolean => {
    switch (pantalla) {
      case 'escaneo':
        return true;
      case 'conflictos':
        return true;
      case 'ciclos':
        return ['esterilizacion', 'supervisor', 'admin'].includes(rol);
      case 'cirugias':
        return ['instrumentadora', 'supervisor', 'admin'].includes(rol);
      case 'stock':
        return ['supervisor', 'admin', 'esterilizacion'].includes(rol);
      case 'catalogos':
        return rol === 'admin';
      case 'cajas':
        return rol === 'admin';
      case 'usuarios':
        return rol === 'admin';
      case 'reportes':
        return ['supervisor', 'admin'].includes(rol);
      default:
        return false;
    }
  };

  // El tipo va en la declaracion y no despues del .filter(): asi el literal
  // queda contextualizado y `id` se estrecha a Pantalla en vez de a string.
  const OPERATIVAS: NavItem[] = [
    { id: 'escaneo', icono: '📷', etiqueta: 'Escaneo' },
    { id: 'cirugias', icono: '🏥', etiqueta: 'Cirugías' },
    { id: 'ciclos', icono: '♻️', etiqueta: 'Esterilización' },
    { id: 'stock', icono: '📦', etiqueta: 'Stock' },
  ];
  const ADMIN: NavItem[] = [
    { id: 'cajas', icono: '🗂', etiqueta: 'Cajas' },
    { id: 'catalogos', icono: '📋', etiqueta: 'Catálogos' },
    { id: 'usuarios', icono: '👥', etiqueta: 'Usuarios' },
    { id: 'reportes', icono: '📊', etiqueta: 'Reportes' },
  ];

  const seccionesOperativas = OPERATIVAS.filter((s) => puedeVer(s.id));
  const seccionesAdmin = ADMIN.filter((s) => puedeVer(s.id));

  return (
    <div className="app-layout">
      {/* ── Sidebar desktop ── */}
      <aside className="sidebar">
        <div className="sidebar__logo">
          <div className="sidebar__logo-icon">⚕️</div>
          <div className="sidebar__logo-text">
            Instrumental
            <span className="sidebar__logo-sub">Gestión quirúrgica</span>
          </div>
        </div>

        <nav className="sidebar__nav">
          {seccionesOperativas.length > 0 && (
            <div className="sidebar__seccion">Operaciones</div>
          )}
          {seccionesOperativas.map((item) => (
            <button
              key={item.id}
              className={`sidebar__item ${pantallaActual === item.id ? 'sidebar__item--activo' : ''}`}
              onClick={() => onNavegar(item.id)}
            >
              <span className="sidebar__item-icon">{item.icono}</span>
              {item.etiqueta}
            </button>
          ))}

          {seccionesAdmin.length > 0 && (
            <div className="sidebar__seccion">Administración</div>
          )}
          {seccionesAdmin.map((item) => (
            <button
              key={item.id}
              className={`sidebar__item ${pantallaActual === item.id ? 'sidebar__item--activo' : ''}`}
              onClick={() => onNavegar(item.id)}
            >
              <span className="sidebar__item-icon">{item.icono}</span>
              {item.etiqueta}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__usuario">
            <div className="sidebar__avatar">{iniciales(usuario.nombre)}</div>
            <div className="sidebar__user-info">
              <div className="sidebar__user-name">{usuario.nombre}</div>
              <div className="sidebar__user-role">{ROLES_ES[rol] ?? rol}</div>
            </div>
          </div>
          <button
            type="button"
            className="sidebar__item"
            style={{ marginTop: '0.25rem' }}
            onClick={onSalir}
          >
            <span className="sidebar__item-icon">🚪</span>
            Salir
          </button>
        </div>
      </aside>

      {/* ── Header móvil ── */}
      <header className="header-movil">
        <div className="header-movil__logo">
          <span>⚕️</span>
          <span>Instrumental</span>
        </div>
        <nav className="header-movil__nav">
          {seccionesOperativas.map((item) => (
            <button
              key={item.id}
              className="header-movil__btn"
              style={pantallaActual === item.id ? { background: 'rgba(13,148,136,.35)', color: '#5eead4' } : {}}
              onClick={() => onNavegar(item.id)}
            >
              {item.icono} {item.etiqueta}
            </button>
          ))}
          {seccionesAdmin.map((item) => (
            <button
              key={item.id}
              className="header-movil__btn"
              style={pantallaActual === item.id ? { background: 'rgba(13,148,136,.35)', color: '#5eead4' } : {}}
              onClick={() => onNavegar(item.id)}
            >
              {item.icono} {item.etiqueta}
            </button>
          ))}
          <button className="header-movil__btn" onClick={onSalir}>
            🚪
          </button>
        </nav>
      </header>

      {/* ── Contenido principal ── */}
      <main className="contenido-principal">{children}</main>
    </div>
  );
}
