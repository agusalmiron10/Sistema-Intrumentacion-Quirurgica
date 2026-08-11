import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import {
  ESTADOS_CAJA,
  ESTADOS_CIRUGIA,
  METODOS_ESTERILIZACION,
  RESULTADOS_CONTROL,
  ROLES_USUARIO,
  TIPOS_MOVIMIENTO_STOCK,
} from '../dominio/estados';

/**
 * Esquema portado de Postgres a D1 (SQLite).
 *
 * Equivalencias aplicadas:
 *   ENUM        -> TEXT + CHECK (campo IN (...))
 *   uuid        -> TEXT (UUID generado en la aplicacion / en el cliente)
 *   timestamptz -> TEXT ISO-8601 UTC, siempre con sufijo Z y milisegundos,
 *                  para que el orden lexicografico coincida con el cronologico
 *   jsonb       -> TEXT con JSON serializado
 *   boolean     -> INTEGER 0/1
 *
 * Los triggers no se modelan aca: viven en migrations/0500_triggers.sql.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CHECK que emula un ENUM de Postgres. */
function checkEnum(nombre: string, columna: string, valores: readonly string[]) {
  const lista = valores.map((v) => `'${v}'`).join(', ');
  return check(nombre, sql.raw(`"${columna}" in (${lista})`));
}

/** CHECK que emula un boolean de Postgres. */
function checkBool(nombre: string, columna: string) {
  return check(nombre, sql.raw(`"${columna}" in (0, 1)`));
}

/** Momento actual en ISO-8601 UTC con milisegundos: 2026-08-10T14:03:11.482Z */
const ahoraIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ---------------------------------------------------------------------------
// Personas y catalogos
// ---------------------------------------------------------------------------

export const usuario = sqliteTable(
  'usuario',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    email: text('email').notNull(),
    /**
     * PIN de 4-6 digitos derivado con PBKDF2-SHA256 (WebCrypto: bcrypt/argon2
     * no corren nativo en Workers). Formato: pbkdf2$<iteraciones>$<salt>$<hash>,
     * ambos en base64. El espacio de claves es chico a proposito (se usa con
     * guantes), por eso el bloqueo por intentos fallidos de mas abajo no es
     * opcional.
     */
    pinHash: text('pin_hash').notNull(),
    rol: text('rol').notNull(),
    intentosFallidos: integer('intentos_fallidos').notNull().default(0),
    bloqueadoHasta: text('bloqueado_hasta'),
    activo: integer('activo').notNull().default(1),
    creadoEn: text('creado_en').notNull().default(ahoraIso),
  },
  (t) => [
    uniqueIndex('usuario_email_uq').on(t.email),
    checkEnum('usuario_rol_ck', 'rol', ROLES_USUARIO),
    checkBool('usuario_activo_ck', 'activo'),
  ],
);

export const cirujano = sqliteTable(
  'cirujano',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    matricula: text('matricula').notNull(),
    especialidad: text('especialidad'),
    notas: text('notas'),
    activo: integer('activo').notNull().default(1),
  },
  (t) => [
    uniqueIndex('cirujano_matricula_uq').on(t.matricula),
    checkBool('cirujano_activo_ck', 'activo'),
  ],
);

export const procedimiento = sqliteTable(
  'procedimiento',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    codigo: text('codigo').notNull(),
    especialidad: text('especialidad'),
    duracionMin: integer('duracion_min'),
    activo: integer('activo').notNull().default(1),
  },
  (t) => [
    uniqueIndex('procedimiento_codigo_uq').on(t.codigo),
    checkBool('procedimiento_activo_ck', 'activo'),
  ],
);

export const instrumentoTipo = sqliteTable(
  'instrumento_tipo',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    codigo: text('codigo').notNull(),
    fabricante: text('fabricante'),
    /** Un instrumento termosensible no tolera vapor a 134 grados. */
    termosensible: integer('termosensible').notNull().default(0),
    activo: integer('activo').notNull().default(1),
  },
  (t) => [
    uniqueIndex('instrumento_tipo_codigo_uq').on(t.codigo),
    checkBool('instrumento_tipo_termosensible_ck', 'termosensible'),
    checkBool('instrumento_tipo_activo_ck', 'activo'),
  ],
);

// ---------------------------------------------------------------------------
// Cajas
// ---------------------------------------------------------------------------

export const caja = sqliteTable(
  'caja',
  {
    id: text('id').primaryKey(),
    /** Codigo legible impreso en la etiqueta, tipeable a mano: LAP-02. */
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    servicio: text('servicio'),
    /**
     * DESNORMALIZACION. Se mantiene exclusivamente por trigger a partir de
     * movimiento_caja; un UPDATE directo sobre esta columna aborta.
     */
    estado: text('estado').notNull().default('esteril_deposito'),
    ubicacion: text('ubicacion'),
    /** Vencimiento de la esterilidad. Lo fija la liberacion del ciclo. */
    venceEl: text('vence_el'),
    ciclosTotales: integer('ciclos_totales').notNull().default(0),
    activa: integer('activa').notNull().default(1),
    creadoEn: text('creado_en').notNull().default(ahoraIso),
  },
  (t) => [
    uniqueIndex('caja_codigo_uq').on(t.codigo),
    index('caja_estado_idx').on(t.estado),
    checkEnum('caja_estado_ck', 'estado', ESTADOS_CAJA),
    checkBool('caja_activa_ck', 'activa'),
    check('caja_ciclos_ck', sql`"ciclos_totales" >= 0`),
  ],
);

export const cajaContenido = sqliteTable(
  'caja_contenido',
  {
    cajaId: text('caja_id')
      .notNull()
      .references(() => caja.id, { onDelete: 'cascade' }),
    instrumentoTipoId: text('instrumento_tipo_id')
      .notNull()
      .references(() => instrumentoTipo.id, { onDelete: 'restrict' }),
    cantidad: integer('cantidad').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cajaId, t.instrumentoTipoId] }),
    check('caja_contenido_cantidad_ck', sql`"cantidad" > 0`),
  ],
);

/**
 * Maquina de estados materializada. El trigger de validacion lee esta tabla,
 * asi que agregar una arista es un INSERT y no un cambio de codigo.
 */
export const transicionValida = sqliteTable(
  'transicion_valida',
  {
    estadoDesde: text('estado_desde').notNull(),
    estadoHasta: text('estado_hasta').notNull(),
    descripcion: text('descripcion'),
  },
  (t) => [
    primaryKey({ columns: [t.estadoDesde, t.estadoHasta] }),
    checkEnum('transicion_desde_ck', 'estado_desde', ESTADOS_CAJA),
    checkEnum('transicion_hasta_ck', 'estado_hasta', ESTADOS_CAJA),
  ],
);

// ---------------------------------------------------------------------------
// Esterilizacion
// ---------------------------------------------------------------------------

export const equipoEsterilizador = sqliteTable(
  'equipo_esterilizador',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    marca: text('marca'),
    ultimaValidacion: text('ultima_validacion'),
    activo: integer('activo').notNull().default(1),
  },
  () => [checkBool('equipo_activo_ck', 'activo')],
);

export const cicloEsterilizacion = sqliteTable(
  'ciclo_esterilizacion',
  {
    id: text('id').primaryKey(),
    numeroLote: text('numero_lote').notNull(),
    equipoId: text('equipo_id')
      .notNull()
      .references(() => equipoEsterilizador.id, { onDelete: 'restrict' }),
    metodo: text('metodo').notNull(),
    iniciadoEn: text('iniciado_en').notNull(),
    finalizadoEn: text('finalizado_en'),
    temperaturaC: integer('temperatura_c'),
    tiempoMin: integer('tiempo_min'),
    controlFisico: text('control_fisico').notNull().default('pendiente'),
    controlQuimico: text('control_quimico').notNull().default('pendiente'),
    /**
     * El control biologico tarda horas. Mientras siga 'pendiente' las cajas
     * del lote no pueden salir de cuarentena; si sale 'no_conforme' se dispara
     * el recall de todo el lote.
     */
    controlBiologico: text('control_biologico').notNull().default('pendiente'),
    operadorId: text('operador_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'restrict' }),
    liberadoPor: text('liberado_por').references(() => usuario.id, { onDelete: 'restrict' }),
    liberadoEn: text('liberado_en'),
    observacion: text('observacion'),
  },
  (t) => [
    uniqueIndex('ciclo_numero_lote_uq').on(t.numeroLote),
    index('ciclo_control_biologico_idx').on(t.controlBiologico),
    checkEnum('ciclo_metodo_ck', 'metodo', METODOS_ESTERILIZACION),
    checkEnum('ciclo_ctrl_fisico_ck', 'control_fisico', RESULTADOS_CONTROL),
    checkEnum('ciclo_ctrl_quimico_ck', 'control_quimico', RESULTADOS_CONTROL),
    checkEnum('ciclo_ctrl_biologico_ck', 'control_biologico', RESULTADOS_CONTROL),
  ],
);

export const cicloCaja = sqliteTable(
  'ciclo_caja',
  {
    cicloId: text('ciclo_id')
      .notNull()
      .references(() => cicloEsterilizacion.id, { onDelete: 'cascade' }),
    cajaId: text('caja_id')
      .notNull()
      .references(() => caja.id, { onDelete: 'restrict' }),
    /** Vencimiento de esterilidad que este ciclo le otorga a esta caja. */
    venceEl: text('vence_el'),
  },
  (t) => [
    primaryKey({ columns: [t.cicloId, t.cajaId] }),
    index('ciclo_caja_caja_idx').on(t.cajaId),
  ],
);

// ---------------------------------------------------------------------------
// Log de movimientos de caja: APPEND-ONLY, fuente de verdad
// ---------------------------------------------------------------------------

export const movimientoCaja = sqliteTable(
  'movimiento_caja',
  {
    /**
     * Generado por el cliente con crypto.randomUUID() ANTES de intentar la red.
     * Es la clave de idempotencia: reenviar el mismo evento tras una
     * desconexion entra por INSERT OR IGNORE y no produce efecto alguno.
     */
    id: text('id').primaryKey(),
    cajaId: text('caja_id')
      .notNull()
      .references(() => caja.id, { onDelete: 'restrict' }),
    estadoDesde: text('estado_desde').notNull(),
    estadoHasta: text('estado_hasta').notNull(),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'restrict' }),
    cirugiaId: text('cirugia_id').references(() => cirugia.id, { onDelete: 'restrict' }),
    cicloId: text('ciclo_id').references(() => cicloEsterilizacion.id, { onDelete: 'restrict' }),
    /** Momento real del escaneo, lo manda el cliente. Puede ser muy anterior. */
    ocurridoEn: text('ocurrido_en').notNull(),
    /** Llegada al servidor. Nunca lo manda el cliente. */
    registradoEn: text('registrado_en').notNull().default(ahoraIso),
    observacion: text('observacion'),
    /** JSON serializado (el jsonb de Postgres). */
    metadata: text('metadata'),
  },
  (t) => [
    index('movimiento_caja_caja_idx').on(t.cajaId, t.ocurridoEn),
    index('movimiento_caja_cirugia_idx').on(t.cirugiaId),
    index('movimiento_caja_ciclo_idx').on(t.cicloId),
    checkEnum('movimiento_desde_ck', 'estado_desde', ESTADOS_CAJA),
    checkEnum('movimiento_hasta_ck', 'estado_hasta', ESTADOS_CAJA),
  ],
);

// ---------------------------------------------------------------------------
// Descartables por lote
// ---------------------------------------------------------------------------

export const descartable = sqliteTable(
  'descartable',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    codigo: text('codigo').notNull(),
    unidad: text('unidad').notNull(),
    /** Umbral de reposicion, sumando el saldo de todos los lotes vigentes. */
    puntoReposicion: integer('punto_reposicion').notNull().default(0),
    activo: integer('activo').notNull().default(1),
  },
  (t) => [
    uniqueIndex('descartable_codigo_uq').on(t.codigo),
    checkBool('descartable_activo_ck', 'activo'),
  ],
);

export const loteDescartable = sqliteTable(
  'lote_descartable',
  {
    id: text('id').primaryKey(),
    descartableId: text('descartable_id')
      .notNull()
      .references(() => descartable.id, { onDelete: 'restrict' }),
    numeroLote: text('numero_lote').notNull(),
    venceEl: text('vence_el'),
    cantidadInicial: integer('cantidad_inicial').notNull().default(0),
    /**
     * DESNORMALIZACION, igual que caja.estado: se mantiene solo por trigger a
     * partir de movimiento_stock. El stock real es la suma del log; esta
     * columna existe para poder ordenar por FEFO sin agregar en cada lectura.
     */
    cantidadActual: integer('cantidad_actual').notNull().default(0),
    recibidoEn: text('recibido_en').notNull().default(ahoraIso),
  },
  (t) => [
    uniqueIndex('lote_descartable_uq').on(t.descartableId, t.numeroLote),
    /** Indice de consumo FEFO: por producto, ordenado por vencimiento. */
    index('lote_fefo_idx').on(t.descartableId, t.venceEl),
    check('lote_cantidad_actual_ck', sql`"cantidad_actual" >= 0`),
    check('lote_cantidad_inicial_ck', sql`"cantidad_inicial" >= 0`),
  ],
);

export const movimientoStock = sqliteTable(
  'movimiento_stock',
  {
    id: text('id').primaryKey(),
    loteId: text('lote_id')
      .notNull()
      .references(() => loteDescartable.id, { onDelete: 'restrict' }),
    tipo: text('tipo').notNull(),
    /**
     * Siempre positiva salvo en 'ajuste', que viaja firmado. El signo con el
     * que impacta el saldo lo decide el tipo (ver SIGNO_MOVIMIENTO_STOCK).
     */
    cantidad: integer('cantidad').notNull(),
    cirugiaId: text('cirugia_id').references(() => cirugia.id, { onDelete: 'restrict' }),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'restrict' }),
    ocurridoEn: text('ocurrido_en').notNull(),
    registradoEn: text('registrado_en').notNull().default(ahoraIso),
    motivo: text('motivo'),
  },
  (t) => [
    index('movimiento_stock_lote_idx').on(t.loteId, t.ocurridoEn),
    index('movimiento_stock_cirugia_idx').on(t.cirugiaId),
    checkEnum('movimiento_stock_tipo_ck', 'tipo', TIPOS_MOVIMIENTO_STOCK),
    check(
      'movimiento_stock_cantidad_ck',
      sql`("tipo" = 'ajuste' and "cantidad" <> 0) or ("tipo" <> 'ajuste' and "cantidad" > 0)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Plantillas (preference cards)
// ---------------------------------------------------------------------------

export const plantilla = sqliteTable(
  'plantilla',
  {
    id: text('id').primaryKey(),
    procedimientoId: text('procedimiento_id')
      .notNull()
      .references(() => procedimiento.id, { onDelete: 'restrict' }),
    /** NULL = plantilla generica del procedimiento, sin preferencia de cirujano. */
    cirujanoId: text('cirujano_id').references(() => cirujano.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    notas: text('notas'),
    vigente: integer('vigente').notNull().default(1),
    creadoEn: text('creado_en').notNull().default(ahoraIso),
  },
  (t) => [
    index('plantilla_resolucion_idx').on(t.procedimientoId, t.cirujanoId, t.vigente),
    checkBool('plantilla_vigente_ck', 'vigente'),
    check('plantilla_version_ck', sql`"version" >= 1`),
  ],
);

export const plantillaCaja = sqliteTable(
  'plantilla_caja',
  {
    plantillaId: text('plantilla_id')
      .notNull()
      .references(() => plantilla.id, { onDelete: 'cascade' }),
    cajaId: text('caja_id')
      .notNull()
      .references(() => caja.id, { onDelete: 'restrict' }),
    obligatoria: integer('obligatoria').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.plantillaId, t.cajaId] }),
    checkBool('plantilla_caja_obligatoria_ck', 'obligatoria'),
  ],
);

export const plantillaDescartable = sqliteTable(
  'plantilla_descartable',
  {
    plantillaId: text('plantilla_id')
      .notNull()
      .references(() => plantilla.id, { onDelete: 'cascade' }),
    descartableId: text('descartable_id')
      .notNull()
      .references(() => descartable.id, { onDelete: 'restrict' }),
    cantidad: integer('cantidad').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.plantillaId, t.descartableId] }),
    check('plantilla_descartable_cantidad_ck', sql`"cantidad" > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Cirugias
// ---------------------------------------------------------------------------

export const cirugia = sqliteTable(
  'cirugia',
  {
    id: text('id').primaryKey(),
    /**
     * Identificador opaco provisto por el sistema del hospital. Sin nombre,
     * sin documento, sin diagnostico: este sistema no guarda datos clinicos.
     */
    pacienteRef: text('paciente_ref').notNull(),
    procedimientoId: text('procedimiento_id')
      .notNull()
      .references(() => procedimiento.id, { onDelete: 'restrict' }),
    cirujanoId: text('cirujano_id')
      .notNull()
      .references(() => cirujano.id, { onDelete: 'restrict' }),
    instrumentadoraId: text('instrumentadora_id').references(() => usuario.id, {
      onDelete: 'restrict',
    }),
    /** Plantilla efectivamente aplicada al preparar. Historico, no se recalcula. */
    plantillaId: text('plantilla_id').references(() => plantilla.id, { onDelete: 'restrict' }),
    quirofano: text('quirofano'),
    programadaPara: text('programada_para').notNull(),
    estado: text('estado').notNull().default('programada'),
    notas: text('notas'),
    creadoEn: text('creado_en').notNull().default(ahoraIso),
  },
  (t) => [
    index('cirugia_programada_idx').on(t.programadaPara),
    index('cirugia_paciente_idx').on(t.pacienteRef),
    checkEnum('cirugia_estado_ck', 'estado', ESTADOS_CIRUGIA),
  ],
);

export const cirugiaCaja = sqliteTable(
  'cirugia_caja',
  {
    cirugiaId: text('cirugia_id')
      .notNull()
      .references(() => cirugia.id, { onDelete: 'cascade' }),
    cajaId: text('caja_id')
      .notNull()
      .references(() => caja.id, { onDelete: 'restrict' }),
    /** 0 = preparada pero no abierta; 1 = efectivamente usada en el paciente. */
    usada: integer('usada').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.cirugiaId, t.cajaId] }),
    index('cirugia_caja_caja_idx').on(t.cajaId),
    checkBool('cirugia_caja_usada_ck', 'usada'),
  ],
);

/**
 * Copia congelada de plantilla_descartable al momento de crear la cirugia.
 * No estaba en la especificacion original: sin esta tabla los descartables
 * planificados no tenian donde guardarse y era imposible comparar planificado
 * contra consumido, ni reconstruir el historico si la plantilla cambiaba.
 */
export const cirugiaDescartable = sqliteTable(
  'cirugia_descartable',
  {
    cirugiaId: text('cirugia_id')
      .notNull()
      .references(() => cirugia.id, { onDelete: 'cascade' }),
    descartableId: text('descartable_id')
      .notNull()
      .references(() => descartable.id, { onDelete: 'restrict' }),
    cantidadPlanificada: integer('cantidad_planificada').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cirugiaId, t.descartableId] }),
    check('cirugia_descartable_cantidad_ck', sql`"cantidad_planificada" > 0`),
  ],
);
