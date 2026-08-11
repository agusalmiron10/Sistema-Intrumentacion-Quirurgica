interface Props {
  pendientes: number;
  conflictos: number;
  enLinea: boolean;
  sincronizando: boolean;
  onSincronizar: () => void;
  onVerConflictos: () => void;
}

/**
 * Estado de la sincronizacion, siempre visible.
 *
 * Que haya escaneos sin subir no puede ser algo que se descubra al final del
 * turno: tiene que estar a la vista todo el tiempo.
 */
export function IndicadorSync({
  pendientes,
  conflictos,
  enLinea,
  sincronizando,
  onSincronizar,
  onVerConflictos,
}: Props) {
  return (
    <div className="sync">
      <span className={`sync__punto ${enLinea ? 'sync__punto--linea' : 'sync__punto--sin-linea'}`} />
      <span className="sync__texto">{enLinea ? 'En linea' : 'Sin conexion'}</span>

      {pendientes > 0 && (
        <button
          type="button"
          className="sync__chip sync__chip--pendiente"
          onClick={onSincronizar}
          disabled={!enLinea || sincronizando}
        >
          {sincronizando ? 'Sincronizando...' : `${pendientes} sin sincronizar`}
        </button>
      )}

      {pendientes === 0 && !sincronizando && (
        <span className="sync__chip sync__chip--ok">Todo sincronizado</span>
      )}

      {conflictos > 0 && (
        <button type="button" className="sync__chip sync__chip--conflicto" onClick={onVerConflictos}>
          {conflictos} {conflictos === 1 ? 'conflicto' : 'conflictos'}
        </button>
      )}
    </div>
  );
}
