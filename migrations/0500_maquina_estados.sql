-- Migracion manual (banda 0500+, ver drizzle.config.ts).
-- Carga la maquina de estados como datos y agrega indices que drizzle-kit
-- no puede expresar.

-- ---------------------------------------------------------------------------
-- Aristas permitidas del ciclo de vida de una caja.
-- El trigger de validacion lee esta tabla: habilitar una transicion nueva
-- es un INSERT, no un cambio de codigo.
-- ---------------------------------------------------------------------------
INSERT INTO transicion_valida (estado_desde, estado_hasta, descripcion) VALUES
  ('esteril_deposito',  'asignada',          'Se reserva para una cirugia programada'),
  ('esteril_deposito',  'en_lavado',         'Retiro preventivo o vencimiento de esterilidad'),
  ('asignada',          'en_quirofano',      'Baja a quirofano'),
  ('asignada',          'esteril_deposito',  'Se libera la reserva: cirugia suspendida'),
  ('asignada',          'en_lavado',         'Recall: el ciclo salio no conforme estando ya asignada'),
  ('en_quirofano',      'usada_sucia',       'Se abrio y se uso en el paciente'),
  ('en_quirofano',      'esteril_deposito',  'Bajo a quirofano pero no se abrio'),
  ('usada_sucia',       'en_lavado',         'Ingresa a la central de esterilizacion'),
  ('en_lavado',         'en_armado',         'Lavada y seca, pasa a mesa de armado'),
  ('en_armado',         'en_esterilizacion', 'Armada y controlada, entra al autoclave'),
  ('en_armado',         'en_reparacion',     'Falta instrumental o hay piezas danadas'),
  ('en_esterilizacion', 'en_cuarentena',     'Termino el ciclo, espera el control biologico'),
  ('en_cuarentena',     'esteril_deposito',  'Liberada: control biologico conforme'),
  ('en_cuarentena',     'en_lavado',         'Recall: control biologico no conforme'),
  ('en_reparacion',     'en_armado',         'Reparada o repuesta la pieza faltante'),
  ('en_reparacion',     'baja',              'Se da de baja definitiva');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Una sola plantilla vigente por (procedimiento, cirujano).
-- El COALESCE es necesario porque en un indice unico los NULL son distintos
-- entre si, y eso permitiria varias plantillas genericas vigentes a la vez.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX plantilla_vigente_uq
  ON plantilla (procedimiento_id, COALESCE(cirujano_id, '__generica__'))
  WHERE vigente = 1;
