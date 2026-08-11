import { useEffect, useState } from 'react';

import type { ConflictoLocal } from '../lib/almacen';
import { legible } from '../lib/cajas';
import { conflictos as leerConflictos, descartarConflicto } from '../lib/cola';

interface Props {
  onVolver: () => void;
  onCambiaron: () => void;
}

/**
 * Escaneos que el servidor rechazo.
 *
 * Existen porque un escaneo rechazado no se puede descartar sin que nadie se
 * entere: alguien movio una caja de verdad y el sistema no lo registro. La
 * usuaria tiene que ver que paso y decidir.
 */
export function Conflictos({ onVolver, onCambiaron }: Props) {
  const [items, setItems] = useState<ConflictoLocal[]>([]);

  const recargar = async (): Promise<void> => setItems(await leerConflictos());

  useEffect(() => {
    void recargar();
  }, []);

  return (
    <main className="pantalla">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Conflictos</h1>
          <p className="sutil">Escaneos que el servidor no acepto</p>
        </div>
        <button type="button" className="boton boton--texto" onClick={onVolver}>
          Volver
        </button>
      </header>

      {items.length === 0 && <p className="sutil">No hay conflictos pendientes.</p>}

      <ul className="conflictos">
        {items.map((item) => {
          // Si el estado real es justo el que se queria dejar, alguien ya hizo
          // el mismo movimiento desde otro dispositivo. Mostrarlo como
          // "se intento X / estado real X" se lee como una contradiccion.
          const yaLoHizoOtro =
            item.codigo === 'conflicto_estado' && item.estadoActual === item.estadoIntentado;

          return (
            <li key={item.id} className="conflicto">
              <div className="conflicto__cabecera">
                <strong className="conflicto__codigo">{item.cajaCodigo || item.cajaRef}</strong>
                <span className="conflicto__hora">
                  {new Date(item.ocurridoEn).toLocaleString('es-AR')}
                </span>
              </div>

              <p className="conflicto__mensaje">
                {yaLoHizoOtro
                  ? 'Otra persona ya registro este mismo movimiento'
                  : item.mensaje}
              </p>

              {!yaLoHizoOtro && (
                <dl className="conflicto__datos">
                  <div>
                    <dt>Se intento</dt>
                    <dd>{legible(item.estadoIntentado)}</dd>
                  </div>
                  {item.estadoActual && (
                    <div>
                      <dt>Estado real</dt>
                      <dd>{legible(item.estadoActual)}</dd>
                    </div>
                  )}
                </dl>
              )}

              {yaLoHizoOtro && (
                <p className="conflicto__sugerencia">
                  La caja quedo en &quot;{legible(item.estadoIntentado)}&quot;, que es lo que
                  buscabas. No hace falta hacer nada.
                </p>
              )}

              {item.codigo === 'conflicto_estado' && !yaLoHizoOtro && (
                <p className="conflicto__sugerencia">
                  La caja ya se habia movido por otro lado. Si el escaneo sigue siendo correcto, hay
                  que volver a hacerlo desde el estado real.
                </p>
              )}
              {item.codigo === 'control_biologico_no_conforme' && (
                <p className="conflicto__sugerencia">
                  La caja no puede salir de cuarentena hasta que el control biologico del ciclo sea
                  conforme.
                </p>
              )}
              {item.codigo === 'caja_vencida' && (
                <p className="conflicto__sugerencia">
                  La esterilidad vencio: la caja tiene que volver a procesarse antes de asignarse.
                </p>
              )}

              <button
                type="button"
                className="boton boton--secundario"
                onClick={async () => {
                  await descartarConflicto(item.id);
                  await recargar();
                  onCambiaron();
                }}
              >
                {yaLoHizoOtro ? 'Entendido' : 'Ya lo resolvi'}
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
