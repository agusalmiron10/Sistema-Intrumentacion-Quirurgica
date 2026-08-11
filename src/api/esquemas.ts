import { z } from 'zod';

import {
  ESTADOS_CAJA,
  ESTADOS_CIRUGIA,
  METODOS_ESTERILIZACION,
  RESULTADOS_CONTROL,
} from '../dominio/estados';
import { normalizarCodigo } from '../dominio/identificadores';

/** ISO-8601 UTC, que es como guardamos todos los timestamps. */
const fechaIso = z
  .string()
  .datetime({ offset: false })
  .describe('ISO-8601 UTC, con Z');

const codigoCaja = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .transform(normalizarCodigo)
  .refine((c) => /^[A-Z0-9][A-Z0-9-]*$/.test(c), {
    message: 'El codigo solo admite letras, numeros y guiones',
  });

const lineaContenido = z.object({
  instrumentoTipoId: z.string().min(1),
  cantidad: z.number().int().positive().max(999),
});

/** El contenido esperado no puede repetir un tipo de instrumento. */
const listaContenido = z
  .array(lineaContenido)
  .max(200)
  .refine(
    (lineas) => new Set(lineas.map((l) => l.instrumentoTipoId)).size === lineas.length,
    { message: 'Hay tipos de instrumento repetidos' },
  );

export const crearCajaSchema = z.object({
  /** Opcional: si el cliente ya lo genero, se respeta (alta offline). */
  id: z.string().min(4).max(64).optional(),
  codigo: codigoCaja,
  nombre: z.string().trim().min(1).max(120),
  servicio: z.string().trim().max(80).nullish(),
  ubicacion: z.string().trim().max(120).nullish(),
  venceEl: fechaIso.nullish(),
  contenido: listaContenido.optional(),
});

/**
 * `estado` no esta y no puede estar: una caja solo cambia de estado por un
 * INSERT en movimiento_caja. `ciclos_totales` tampoco: lo lleva el trigger.
 */
export const actualizarCajaSchema = z
  .strictObject({
    codigo: codigoCaja,
    nombre: z.string().trim().min(1).max(120),
    servicio: z.string().trim().max(80).nullable(),
    ubicacion: z.string().trim().max(120).nullable(),
    venceEl: fechaIso.nullable(),
    activa: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay nada que actualizar' });

export const reemplazarContenidoSchema = z.object({
  contenido: listaContenido,
});

export const filtrosCajaSchema = z.object({
  estado: z.enum(ESTADOS_CAJA).optional(),
  servicio: z.string().trim().min(1).optional(),
  /** Busqueda por codigo o nombre. */
  q: z.string().trim().min(1).max(80).optional(),
  activa: z.enum(['1', '0']).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

export const etiquetasSchema = z.object({
  /** Ids o codigos legibles, mezclados: se resuelven igual que en el escaneo. */
  refs: z.array(z.string().trim().min(1)).min(1).max(500),
  /**
   * Lado del QR en milimetros. El minimo del pliego es 20mm; el default es 25
   * porque a 20mm y con la URL larga el modulo queda demasiado chico para una
   * etiqueta gastada.
   */
  ladoQrMm: z.number().min(20).max(60).default(25),
  incluirBorde: z.boolean().default(true),
});

export const ingresoSchema = z.object({
  usuarioId: z.string().min(1).max(64),
  /** 4 a 6 digitos: se tipea con guantes. La seguridad la da el bloqueo. */
  pin: z.string().regex(/^\d{4,6}$/, 'El PIN son 4 a 6 digitos'),
});

const eventoSchema = z.object({
  /** UUID generado por el cliente: es la clave de idempotencia. */
  id: z.uuid(),
  cajaRef: z.string().trim().min(1).max(64),
  /**
   * Quien escaneo, segun el dispositivo. No se deduce de la sesion: la cola
   * offline puede sincronizarse horas despues, cuando en la tablet ya ingreso
   * otra persona, y el evento tiene que quedar a nombre de quien lo hizo.
   */
  usuarioId: z.string().min(1).max(64),
  estadoDesde: z.enum(ESTADOS_CAJA),
  estadoHasta: z.enum(ESTADOS_CAJA),
  ocurridoEn: fechaIso,
  cirugiaId: z.string().min(1).max(64).nullish(),
  cicloId: z.string().min(1).max(64).nullish(),
  observacion: z.string().trim().max(500).nullish(),
});

export const sincronizarSchema = z.object({
  /**
   * Se aceptan lotes porque la cola offline puede haber juntado un turno
   * entero. El tope evita que un cliente con la cola corrupta tumbe el Worker.
   */
  eventos: z.array(eventoSchema).min(1).max(500),
});

// ---------------------------------------------------------------------------
// Esterilizacion
// ---------------------------------------------------------------------------

const resultadoControl = z.enum(RESULTADOS_CONTROL);

export const crearCicloSchema = z.object({
  numeroLote: z.string().trim().min(1).max(40),
  equipoId: z.string().min(1).max(64),
  metodo: z.enum(METODOS_ESTERILIZACION),
  iniciadoEn: fechaIso,
  /** Ids o codigos de las cajas escaneadas al cargar el equipo. */
  cajaRefs: z.array(z.string().trim().min(1)).min(1).max(100),
  observacion: z.string().trim().max(500).nullish(),
});

export const finalizarCicloSchema = z.object({
  finalizadoEn: fechaIso,
  temperaturaC: z.number().int().min(0).max(300).nullish(),
  tiempoMin: z.number().int().min(0).max(2000).nullish(),
});

export const controlesSchema = z
  .object({
    controlFisico: resultadoControl.optional(),
    controlQuimico: resultadoControl.optional(),
    controlBiologico: resultadoControl.optional(),
    ocurridoEn: fechaIso.optional(),
  })
  .refine(
    (v) =>
      v.controlFisico !== undefined ||
      v.controlQuimico !== undefined ||
      v.controlBiologico !== undefined,
    { message: 'Hay que indicar al menos un control' },
  );

export const liberarCicloSchema = z.object({
  liberadoEn: fechaIso.optional(),
  /** Sobreescribe la vigencia por defecto: depende del empaque y de la politica. */
  diasVigencia: z.number().int().min(1).max(1095).optional(),
});

export const filtrosCicloSchema = z.object({
  controlBiologico: resultadoControl.optional(),
  equipoId: z.string().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Plantillas y cirugias
// ---------------------------------------------------------------------------

export const crearPlantillaSchema = z.object({
  procedimientoId: z.string().min(1).max(64),
  /** null = plantilla generica del procedimiento, sin preferencia de cirujano. */
  cirujanoId: z.string().min(1).max(64).nullish(),
  notas: z.string().trim().max(1000).nullish(),
  cajas: z
    .array(z.object({ cajaId: z.string().min(1), obligatoria: z.boolean().optional() }))
    .max(50)
    .default([]),
  descartables: z
    .array(
      z.object({
        descartableId: z.string().min(1),
        cantidad: z.number().int().positive().max(999),
      }),
    )
    .max(100)
    .default([]),
});

export const filtrosPlantillaSchema = z.object({
  procedimientoId: z.string().min(1).optional(),
  cirujanoId: z.string().min(1).optional(),
  soloVigentes: z
    .enum(['1', '0'])
    .default('1')
    .transform((v) => v === '1'),
});

export const crearCirugiaSchema = z.object({
  /** Identificador opaco. Nada de nombre, documento ni diagnostico. */
  pacienteRef: z.string().trim().min(1).max(64),
  procedimientoId: z.string().min(1).max(64),
  cirujanoId: z.string().min(1).max(64),
  instrumentadoraId: z.string().min(1).max(64).nullish(),
  quirofano: z.string().trim().max(20).nullish(),
  programadaPara: fechaIso,
  notas: z.string().trim().max(1000).nullish(),
});

export const filtrosCirugiaSchema = z.object({
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  estado: z.enum(ESTADOS_CIRUGIA).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});

export const cambiarEstadoCirugiaSchema = z.object({
  estado: z.enum(ESTADOS_CIRUGIA),
  ocurridoEn: fechaIso.optional(),
});

export const cajaDeCirugiaSchema = z.object({
  cajaRef: z.string().trim().min(1).max(64),
  usada: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Stock de descartables
// ---------------------------------------------------------------------------

export const crearDescartableSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  codigo: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .transform((c) => c.toUpperCase()),
  unidad: z.string().trim().min(1).max(20),
  puntoReposicion: z.number().int().min(0).max(100000).default(0),
});

export const recibirLoteSchema = z.object({
  descartableRef: z.string().trim().min(1).max(64),
  numeroLote: z.string().trim().min(1).max(40),
  venceEl: fechaIso.nullish(),
  cantidad: z.number().int().positive().max(100000),
  recibidoEn: fechaIso.optional(),
  motivo: z.string().trim().max(200).nullish(),
});

export const consumoSchema = z.object({
  descartableRef: z.string().trim().min(1).max(64),
  cantidad: z.number().int().positive().max(100000),
  cirugiaId: z.string().min(1).max(64).nullish(),
  ocurridoEn: fechaIso.optional(),
  motivo: z.string().trim().max(200).nullish(),
});

export const movimientoStockSchema = z.object({
  loteId: z.string().min(1).max(64),
  tipo: z.enum(['devolucion', 'ajuste', 'vencido']),
  /** En `ajuste` viaja firmado; en el resto tiene que ser positivo. */
  cantidad: z.number().int().max(100000),
  cirugiaId: z.string().min(1).max(64).nullish(),
  ocurridoEn: fechaIso.optional(),
  motivo: z.string().trim().max(200).nullish(),
});

export const filtrosStockSchema = z.object({
  loteId: z.string().min(1).optional(),
  cirugiaId: z.string().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

export const alertasSchema = z.object({
  diasAviso: z.coerce.number().int().min(1).max(365).default(60),
});

export type Evento = z.infer<typeof eventoSchema>;
export type CrearCaja = z.infer<typeof crearCajaSchema>;
export type ActualizarCaja = z.infer<typeof actualizarCajaSchema>;
export type FiltrosCaja = z.infer<typeof filtrosCajaSchema>;
export type OpcionesEtiquetas = z.infer<typeof etiquetasSchema>;
