import { useEffect, useState } from 'react';

import { ErrorApi, pedir } from '../lib/api';

interface Props {
  onVolver: () => void;
}

interface Caja {
  id: string;
  codigo: string;
  nombre: string;
  servicio: string | null;
  ubicacion: string | null;
  estado: string;
  activa: number;
  ciclosTotales: number;
}

const ESTADOS: Record<string, string> = {
  en_deposito: 'En depósito',
  en_lavado: 'En lavado',
  en_armado: 'En armado',
  en_esterilizacion: 'En esterilización',
  esterilizada: 'Esterilizada',
  en_cirugia: 'En cirugía',
  usada: 'Usada',
};

interface Movimiento {
  id: string;
  estadoDesde: string;
  estadoHasta: string;
  ocurridoEn: string;
  observacion?: string;
}

/** Alta y listado de cajas quirúrgicas. Solo la ve un administrador. */
export function Cajas({ onVolver }: Props) {
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [servicio, setServicio] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Historial
  const [viendoHistorial, setViendoHistorial] = useState<Caja | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const recargar = async (): Promise<void> => {
    try {
      const resultado = await pedir<Caja[]>('/api/cajas');
      setCajas(resultado);
    } catch (problema) {
      setError(problema instanceof ErrorApi ? problema.message : 'No se pudo cargar la lista');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void recargar();
  }, []);

  const completo = codigo.trim() !== '' && nombre.trim() !== '';

  const crear = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      await pedir('/api/cajas', {
        metodo: 'POST',
        cuerpo: {
          codigo: codigo.trim(),
          nombre: nombre.trim(),
          ...(servicio.trim() ? { servicio: servicio.trim() } : {}),
          ...(ubicacion.trim() ? { ubicacion: ubicacion.trim() } : {}),
        },
      });
      setExito(`Caja "${codigo.trim().toUpperCase()}" creada correctamente.`);
      setCodigo('');
      setNombre('');
      setServicio('');
      setUbicacion('');
      await recargar();
    } catch (problema) {
      if (problema instanceof ErrorApi && problema.estado === 409) {
        setError('Ya existe una caja con ese código.');
      } else if (problema instanceof ErrorApi && problema.estado === 400) {
        setError('Código inválido: solo letras, números y guiones (mínimo 2 caracteres).');
      } else if (problema instanceof ErrorApi) {
        setError(problema.message);
      } else {
        setError('No se pudo crear la caja.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const toggleActiva = async (caja: Caja): Promise<void> => {
    setError(null);
    setExito(null);
    try {
      await pedir(`/api/cajas/${caja.id}`, {
        metodo: 'PATCH',
        cuerpo: { activa: caja.activa === 0 },
      });
      await recargar();
    } catch (problema) {
      setError(problema instanceof ErrorApi ? problema.message : 'No se pudo actualizar');
    }
  };

  const verHistorial = async (caja: Caja): Promise<void> => {
    setViendoHistorial(caja);
    setCargandoHistorial(true);
    try {
      const resp = await pedir<{ movimientos: Movimiento[] }>(`/api/cajas/${caja.id}/historial`);
      setMovimientos(resp.movimientos);
    } catch (p) {
      setError(p instanceof ErrorApi ? p.message : 'No se pudo cargar el historial');
      setViendoHistorial(null);
    } finally {
      setCargandoHistorial(false);
    }
  };

  if (viendoHistorial) {
    return (
      <main className="pantalla">
        <header className="cabecera">
          <div>
            <h1 className="titulo">Historial de caja</h1>
            <p className="sutil">{viendoHistorial.nombre} ({viendoHistorial.codigo})</p>
          </div>
          <button type="button" className="boton boton--texto" onClick={() => setViendoHistorial(null)}>
            Cerrar historial
          </button>
        </header>

        {cargandoHistorial && <p className="sutil">Cargando movimientos...</p>}
        {!cargandoHistorial && movimientos.length === 0 && (
          <p className="sutil">Esta caja no tiene movimientos registrados.</p>
        )}
        {!cargandoHistorial && movimientos.length > 0 && (
          <ul className="lista-admin">
            {movimientos.map((m) => (
              <li key={m.id} className="admin">
                <div className="admin__datos">
                  <strong>{new Date(m.ocurridoEn).toLocaleString('es-AR')}</strong>
                  <span className="sutil">
                    {ESTADOS[m.estadoDesde] ?? m.estadoDesde} → {ESTADOS[m.estadoHasta] ?? m.estadoHasta}
                  </span>
                  {m.observacion && <span className="sutil" style={{ color: 'var(--brand-600)' }}>Nota: {m.observacion}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Cajas</h1>
          <p className="sutil">Registrá las cajas de instrumental que circulan por el quirófano</p>
        </div>
        <button type="button" className="boton boton--texto" onClick={onVolver}>
          Volver
        </button>
      </header>

      {error && <p className="aviso aviso--error">{error}</p>}
      {exito && <p className="aviso aviso--ok">{exito}</p>}

      <section className="tarjeta">
        <h2 className="tarjeta__titulo">Nueva caja</h2>
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault();
            if (completo && !enviando) void crear();
          }}
        >
          <label className="campo">
            <span className="campo__etiqueta">Código</span>
            <input
              className="campo__control"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="Ej: LAP-02"
              maxLength={32}
              autoCapitalize="characters"
            />
            <span className="campo__ayuda">
              Letras, números y guiones. Se imprime en la etiqueta y el QR.
            </span>
          </label>

          <label className="campo">
            <span className="campo__etiqueta">Nombre</span>
            <input
              className="campo__control"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Caja laparoscopía 2"
              maxLength={120}
            />
          </label>

          <label className="campo">
            <span className="campo__etiqueta">Servicio (opcional)</span>
            <input
              className="campo__control"
              value={servicio}
              onChange={(e) => setServicio(e.target.value)}
              placeholder="Ej: Cirugía general"
              maxLength={80}
            />
          </label>

          <label className="campo">
            <span className="campo__etiqueta">Ubicación (opcional)</span>
            <input
              className="campo__control"
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
              placeholder="Ej: Depósito A - estante 3"
              maxLength={120}
            />
          </label>

          <button type="submit" className="boton boton--primario" disabled={!completo || enviando}>
            {enviando ? 'Creando...' : 'Crear caja'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="tarjeta__titulo">Cajas registradas</h2>
        {cargando && <p className="sutil">Cargando...</p>}
        {!cargando && cajas.length === 0 && (
          <p className="sutil">Todavía no hay cajas. Creá la primera arriba.</p>
        )}

        <ul className="lista-admin">
          {cajas.map((caja) => (
            <li key={caja.id} className={`admin ${caja.activa === 0 ? 'admin--baja' : ''}`}>
              <div className="admin__datos">
                <strong>{caja.codigo}</strong>
                <span className="sutil">{caja.nombre}</span>
                {caja.servicio && <span className="sutil">{caja.servicio}</span>}
                <span className="admin__rol">{ESTADOS[caja.estado] ?? caja.estado}</span>
                <span className="sutil">{caja.ciclosTotales} ciclo{caja.ciclosTotales !== 1 ? 's' : ''}</span>
                {caja.activa === 0 && <span className="admin__estado">inactiva</span>}
              </div>

              <div className="admin__acciones">
                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void verHistorial(caja)}
                >
                  Historial
                </button>
                <button
                  type="button"
                  className="boton boton--secundario boton--chico"
                  onClick={() => void toggleActiva(caja)}
                >
                  {caja.activa === 0 ? 'Reactivar' : 'Desactivar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
