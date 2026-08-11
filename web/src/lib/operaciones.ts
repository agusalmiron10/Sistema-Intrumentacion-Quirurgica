import type { EstadoCaja } from '../../../src/dominio/estados';

/**
 * Lo que la usuaria elige antes de empezar a escanear.
 *
 * Se elige la operacion, no el par de estados: nadie piensa "de en_lavado a
 * en_armado", piensa "estoy armando". El estado de origen sale del estado que
 * la caja ya tiene, y lo pone el sistema.
 */
export interface Operacion {
  id: string;
  etiqueta: string;
  descripcion: string;
  hasta: EstadoCaja;
  /** Operaciones que van a necesitar elegir un ciclo o una cirugia (fases 4 y 5). */
  pendienteDeFase?: string;
}

export const OPERACIONES: readonly Operacion[] = [
  {
    id: 'lavado',
    etiqueta: 'Ingreso a lavado',
    descripcion: 'La caja llega a la central de esterilizacion',
    hasta: 'en_lavado',
  },
  {
    id: 'armado',
    etiqueta: 'Pasar a armado',
    descripcion: 'Lavada y seca, va a la mesa de armado',
    hasta: 'en_armado',
  },
  {
    id: 'esterilizacion',
    etiqueta: 'Cargar autoclave',
    descripcion: 'Armada y controlada, entra al equipo',
    hasta: 'en_esterilizacion',
    pendienteDeFase: 'El ciclo se elige a partir de la fase 4',
  },
  {
    id: 'cuarentena',
    etiqueta: 'Retirar del autoclave',
    descripcion: 'Termino el ciclo, queda esperando el control biologico',
    hasta: 'en_cuarentena',
  },
  {
    id: 'deposito',
    etiqueta: 'Liberar a deposito',
    descripcion: 'Control biologico conforme: vuelve al deposito esteril',
    hasta: 'esteril_deposito',
  },
  {
    id: 'asignar',
    etiqueta: 'Asignar a cirugia',
    descripcion: 'Se reserva para una cirugia programada',
    hasta: 'asignada',
    pendienteDeFase: 'La cirugia se elige a partir de la fase 5',
  },
  {
    id: 'quirofano',
    etiqueta: 'Bajar a quirofano',
    descripcion: 'La caja sale del deposito hacia el quirofano',
    hasta: 'en_quirofano',
  },
  {
    id: 'usada',
    etiqueta: 'Marcar como usada',
    descripcion: 'Se abrio y se uso en el paciente',
    hasta: 'usada_sucia',
  },
  {
    id: 'reparacion',
    etiqueta: 'Enviar a reparacion',
    descripcion: 'Falta instrumental o hay piezas danadas',
    hasta: 'en_reparacion',
  },
  {
    id: 'baja',
    etiqueta: 'Dar de baja',
    descripcion: 'Se retira definitivamente del circuito',
    hasta: 'baja',
  },
];

export function operacionPorId(id: string): Operacion | undefined {
  return OPERACIONES.find((o) => o.id === id);
}
