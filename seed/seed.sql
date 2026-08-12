-- Datos de prueba realistas.
--
-- Importante: los estados de las cajas NO se escriben a mano. Las cajas se
-- crean en 'esteril_deposito' y llegan a su estado actual insertando
-- movimientos reales, igual que en produccion. Si algun trigger esta mal, el
-- seed falla: es el primer test del sistema.
--
-- caja-003 (GEN-01) y caja-005 (TRA-01) quedan sin historial a proposito:
-- representan la carga inicial del inventario, cajas que ya estaban en el
-- deposito cuando se puso en marcha el sistema.

-- ---------------------------------------------------------------------------
-- Usuarios
-- PIN de desarrollo (PBKDF2-SHA256, 210000 iteraciones). NO usar en produccion.
--   Marcela 1234 | Silvia 2345 | Roberto 3456 | Admin 9999
-- ---------------------------------------------------------------------------
INSERT INTO usuario (id, nombre, email, pin_hash, rol) VALUES
  ('u-001', 'Marcela Duarte',  'marcela.duarte@hospital.local',  'pbkdf2$sha256$100000$4HGCwfJ+zYhP/xJlxufjPw==$VDHfTjBlw/gAlw3r947ptuqMYgtlWTfyh3YwIhG8d44=', 'instrumentadora'),
  ('u-002', 'Silvia Ocampo',   'silvia.ocampo@hospital.local',   'pbkdf2$sha256$100000$uBjV8ErnM63bETnTUrPE6Q==$+5SK2nSHRpCDFTA+oL81mGRt3pjoJ92fChTS8pUpw60=', 'esterilizacion'),
  ('u-003', 'Roberto Paz',     'roberto.paz@hospital.local',     'pbkdf2$sha256$100000$l5D+EJTYCbMaC/5lud/Rgg==$EXikSidignWbxEoxi1H1+/nblGAk636SNo0lMEH8YUM=', 'supervisor'),
  ('u-004', 'Administracion',  'admin@hospital.local',           'pbkdf2$sha256$100000$B1ucGhMf5BlPn6DdTmjqtw==$tx9T/R67wd9nvx1aZSf+q/sNwU5Bm/arQpPqcc83N30=', 'admin');

INSERT INTO cirujano (id, nombre, matricula, especialidad, notas) VALUES
  ('ciru-001', 'Dr. Alejandro Sosa',  'MN 84213', 'Cirugia general', 'Prefiere Metzenbaum largo. Pide clips de titanio siempre.'),
  ('ciru-002', 'Dra. Laura Bianchi',  'MN 91055', 'Traumatologia',   'Trabaja con manguito hemostatico. Avisar 20 min antes.'),
  ('ciru-003', 'Dr. Hugo Ferreyra',   'MN 77340', 'Ginecologia',     NULL);

INSERT INTO procedimiento (id, nombre, codigo, especialidad, duracion_min) VALUES
  ('proc-001', 'Colecistectomia laparoscopica', 'COLE-LAP',  'Cirugia general', 90),
  ('proc-002', 'Hernioplastia inguinal',        'HERN-ING',  'Cirugia general', 75),
  ('proc-003', 'Artroscopia de rodilla',        'ARTRO-ROD', 'Traumatologia',   60),
  ('proc-004', 'Cesarea',                       'CESAREA',   'Ginecologia',     45);

INSERT INTO instrumento_tipo (id, nombre, codigo, fabricante, termosensible) VALUES
  ('inst-001', 'Pinza Kelly curva 16cm',          'KEL-C16',  'Aesculap', 0),
  ('inst-002', 'Portaagujas Mayo-Hegar 18cm',     'PAG-MH18', 'Aesculap', 0),
  ('inst-003', 'Tijera Metzenbaum 20cm',          'TIJ-MTZ20','Aesculap', 0),
  ('inst-004', 'Separador Farabeuf (par)',        'SEP-FAR',  'Aesculap', 0),
  ('inst-005', 'Optica 30 grados 10mm',           'OPT-30',   'Karl Storz', 1),
  ('inst-006', 'Pinza grasper laparoscopica 5mm', 'LAP-GRA5', 'Karl Storz', 0),
  ('inst-007', 'Trocar 12mm',                     'TRO-12',   'Karl Storz', 0),
  ('inst-008', 'Pinza Backhaus 13cm',             'BAK-13',   'Aesculap', 0),
  ('inst-009', 'Mango de bisturi n4',             'MB-4',     'Aesculap', 0),
  ('inst-010', 'Gubia Kerrison 3mm',              'GUB-K3',   'Aesculap', 0);

INSERT INTO equipo_esterilizador (id, nombre, marca, ultima_validacion) VALUES
  ('eq-001', 'Autoclave Central 1', 'Getinge',    '2026-07-01T00:00:00.000Z'),
  ('eq-002', 'Autoclave Central 2', 'Tuttnauer',  '2026-07-01T00:00:00.000Z'),
  ('eq-003', 'Plasma de peroxido',  'Sterrad NX', '2026-06-15T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Cajas: todas nacen en el deposito esteril
-- ---------------------------------------------------------------------------
INSERT INTO caja (id, codigo, nombre, servicio, ubicacion) VALUES
  ('caja-001', 'LAP-01', 'Caja laparoscopia 1',      'Cirugia general', 'Deposito esteril - estante A2'),
  ('caja-002', 'LAP-02', 'Caja laparoscopia 2',      'Cirugia general', 'Deposito esteril - estante A2'),
  ('caja-003', 'GEN-01', 'Caja cirugia general 1',   'Cirugia general', 'Deposito esteril - estante B1'),
  ('caja-004', 'GEN-02', 'Caja cirugia general 2',   'Cirugia general', 'Deposito esteril - estante B1'),
  ('caja-005', 'TRA-01', 'Caja artroscopia rodilla', 'Traumatologia',   'Deposito esteril - estante C3'),
  ('caja-006', 'OBS-01', 'Caja cesarea',             'Obstetricia',     'Deposito esteril - estante D1'),
  ('caja-007', 'GEN-03', 'Caja cirugia general 3',   'Cirugia general', 'Deposito esteril - estante B2'),
  ('caja-008', 'LAP-03', 'Caja laparoscopia 3',      'Cirugia general', 'Deposito esteril - estante A3');

INSERT INTO caja_contenido (caja_id, instrumento_tipo_id, cantidad) VALUES
  ('caja-001', 'inst-005', 1), ('caja-001', 'inst-006', 3), ('caja-001', 'inst-007', 3),
  ('caja-001', 'inst-003', 1), ('caja-001', 'inst-008', 4),
  ('caja-002', 'inst-005', 1), ('caja-002', 'inst-006', 3), ('caja-002', 'inst-007', 3),
  ('caja-002', 'inst-003', 1), ('caja-002', 'inst-008', 4),
  ('caja-003', 'inst-001', 6), ('caja-003', 'inst-002', 2), ('caja-003', 'inst-003', 2),
  ('caja-003', 'inst-004', 1), ('caja-003', 'inst-008', 6), ('caja-003', 'inst-009', 2),
  ('caja-004', 'inst-001', 6), ('caja-004', 'inst-002', 2), ('caja-004', 'inst-003', 2),
  ('caja-004', 'inst-004', 1), ('caja-004', 'inst-008', 6), ('caja-004', 'inst-009', 2),
  ('caja-005', 'inst-010', 2), ('caja-005', 'inst-002', 1), ('caja-005', 'inst-008', 4),
  ('caja-006', 'inst-001', 8), ('caja-006', 'inst-002', 2), ('caja-006', 'inst-004', 2),
  ('caja-006', 'inst-008', 6), ('caja-006', 'inst-009', 1),
  ('caja-007', 'inst-001', 6), ('caja-007', 'inst-002', 2), ('caja-007', 'inst-009', 2),
  ('caja-008', 'inst-005', 1), ('caja-008', 'inst-006', 3), ('caja-008', 'inst-007', 3);

-- ---------------------------------------------------------------------------
-- Descartables y lotes.
-- Los lotes se crean con saldo 0 y se cargan con un movimiento 'ingreso':
-- el saldo nunca se escribe a mano, lo calcula el trigger.
-- Los vencimientos estan escalonados a proposito para poder probar FEFO.
-- ---------------------------------------------------------------------------
INSERT INTO descartable (id, nombre, codigo, unidad, punto_reposicion) VALUES
  ('desc-001', 'Sutura Vicryl 2-0 aguja 26mm', 'SUT-VIC-20', 'unidad',    40),
  ('desc-002', 'Sutura Prolene 3-0',           'SUT-PRO-30', 'unidad',    30),
  ('desc-003', 'Malla polipropileno 15x15',    'MAL-PP-15',  'unidad',    10),
  ('desc-004', 'Gasa esteril 10x10 (paq x5)',  'GAS-10',     'paquete',  100),
  ('desc-005', 'Hoja de bisturi n24',          'HOJ-24',     'unidad',    50),
  ('desc-006', 'Clips hemostaticos titanio',   'CLIP-TI',    'cartucho',  15);

INSERT INTO lote_descartable (id, descartable_id, numero_lote, vence_el, cantidad_inicial, cantidad_actual, recibido_en) VALUES
  ('lote-001', 'desc-001', 'L-VIC-2211', '2026-09-30T00:00:00.000Z', 150, 0, '2026-05-12T10:00:00.000Z'),
  ('lote-002', 'desc-001', 'L-VIC-2318', '2027-03-31T00:00:00.000Z', 200, 0, '2026-07-02T10:00:00.000Z'),
  ('lote-003', 'desc-002', 'L-PRO-1140', '2026-08-31T00:00:00.000Z',  60, 0, '2026-04-20T10:00:00.000Z'),
  ('lote-004', 'desc-003', 'L-MAL-0087', '2028-01-31T00:00:00.000Z',  25, 0, '2026-06-01T10:00:00.000Z'),
  ('lote-005', 'desc-004', 'L-GAS-5512', '2027-06-30T00:00:00.000Z', 400, 0, '2026-06-18T10:00:00.000Z'),
  ('lote-006', 'desc-005', 'L-HOJ-3301', '2029-12-31T00:00:00.000Z', 300, 0, '2026-03-05T10:00:00.000Z'),
  ('lote-007', 'desc-006', 'L-CLI-2044', '2027-11-30T00:00:00.000Z',  40, 0, '2026-07-10T10:00:00.000Z');

INSERT INTO movimiento_stock (id, lote_id, tipo, cantidad, usuario_id, ocurrido_en, motivo) VALUES
  ('ms-001', 'lote-001', 'ingreso', 150, 'u-004', '2026-05-12T10:05:00.000Z', 'Recepcion de farmacia'),
  ('ms-002', 'lote-002', 'ingreso', 200, 'u-004', '2026-07-02T10:05:00.000Z', 'Recepcion de farmacia'),
  ('ms-003', 'lote-003', 'ingreso',  60, 'u-004', '2026-04-20T10:05:00.000Z', 'Recepcion de farmacia'),
  ('ms-004', 'lote-004', 'ingreso',  25, 'u-004', '2026-06-01T10:05:00.000Z', 'Recepcion de farmacia'),
  ('ms-005', 'lote-005', 'ingreso', 400, 'u-004', '2026-06-18T10:05:00.000Z', 'Recepcion de farmacia'),
  ('ms-006', 'lote-006', 'ingreso', 300, 'u-004', '2026-03-05T10:05:00.000Z', 'Recepcion de farmacia'),
  ('ms-007', 'lote-007', 'ingreso',  40, 'u-004', '2026-07-10T10:05:00.000Z', 'Recepcion de farmacia');

-- ---------------------------------------------------------------------------
-- Plantillas (preference cards)
-- ---------------------------------------------------------------------------
INSERT INTO plantilla (id, procedimiento_id, cirujano_id, version, notas, vigente) VALUES
  ('pl-001', 'proc-001', NULL,       1, 'Colecistectomia laparoscopica - armado estandar del servicio', 1),
  ('pl-002', 'proc-001', 'ciru-001', 2, 'Preferencias Dr. Sosa: dos cartuchos de clips y Prolene de reserva', 1),
  ('pl-003', 'proc-002', NULL,       1, 'Hernioplastia inguinal - tecnica Lichtenstein con malla', 1),
  ('pl-004', 'proc-003', NULL,       1, 'Artroscopia de rodilla - armado estandar', 1);

INSERT INTO plantilla_caja (plantilla_id, caja_id, obligatoria) VALUES
  ('pl-001', 'caja-001', 1), ('pl-001', 'caja-003', 1),
  ('pl-002', 'caja-001', 1), ('pl-002', 'caja-003', 1), ('pl-002', 'caja-004', 0),
  ('pl-003', 'caja-003', 1),
  ('pl-004', 'caja-005', 1);

INSERT INTO plantilla_descartable (plantilla_id, descartable_id, cantidad) VALUES
  ('pl-001', 'desc-001', 2), ('pl-001', 'desc-004', 4), ('pl-001', 'desc-005', 2), ('pl-001', 'desc-006', 1),
  ('pl-002', 'desc-001', 2), ('pl-002', 'desc-002', 1), ('pl-002', 'desc-004', 6), ('pl-002', 'desc-005', 2), ('pl-002', 'desc-006', 2),
  ('pl-003', 'desc-002', 2), ('pl-003', 'desc-003', 1), ('pl-003', 'desc-004', 4), ('pl-003', 'desc-005', 1),
  ('pl-004', 'desc-004', 3), ('pl-004', 'desc-005', 1);

-- ---------------------------------------------------------------------------
-- Cirugias. paciente_ref es opaco: no hay nombre, documento ni diagnostico.
-- La plantilla ya viene resuelta y copiada (cirugia_caja / cirugia_descartable).
-- ---------------------------------------------------------------------------
INSERT INTO cirugia (id, paciente_ref, procedimiento_id, cirujano_id, instrumentadora_id, plantilla_id, quirofano, programada_para, estado, notas) VALUES
  ('cir-001', 'PAC-8842', 'proc-001', 'ciru-001', 'u-001', 'pl-002', 'Q3', '2026-08-08T11:00:00.000Z', 'finalizada',  'Sin complicaciones.'),
  ('cir-002', 'PAC-9130', 'proc-002', 'ciru-001', 'u-001', 'pl-003', 'Q1', '2026-08-12T13:30:00.000Z', 'programada',  NULL),
  ('cir-003', 'PAC-7765', 'proc-003', 'ciru-002', 'u-001', 'pl-004', 'Q2', '2026-08-13T09:00:00.000Z', 'programada',  NULL);

INSERT INTO cirugia_caja (cirugia_id, caja_id, usada) VALUES
  ('cir-001', 'caja-004', 1),
  ('cir-002', 'caja-003', 0),
  ('cir-003', 'caja-005', 0);

INSERT INTO cirugia_descartable (cirugia_id, descartable_id, cantidad_planificada) VALUES
  ('cir-001', 'desc-001', 2), ('cir-001', 'desc-002', 1), ('cir-001', 'desc-004', 6),
  ('cir-001', 'desc-005', 2), ('cir-001', 'desc-006', 2),
  ('cir-002', 'desc-002', 2), ('cir-002', 'desc-003', 1), ('cir-002', 'desc-004', 4), ('cir-002', 'desc-005', 1),
  ('cir-003', 'desc-004', 3), ('cir-003', 'desc-005', 1);

-- ---------------------------------------------------------------------------
-- Ciclos de esterilizacion.
-- Se cargan antes que los movimientos porque el trigger mc_val_control_biologico
-- consulta ciclo_caja para decidir si una caja puede salir de cuarentena.
-- ---------------------------------------------------------------------------
INSERT INTO ciclo_esterilizacion
  (id, numero_lote, equipo_id, metodo, iniciado_en, finalizado_en, temperatura_c, tiempo_min,
   control_fisico, control_quimico, control_biologico, operador_id, liberado_por, liberado_en, observacion) VALUES
  ('ciclo-001', '2026-0417', 'eq-001', 'vapor_134', '2026-08-05T16:05:00.000Z', '2026-08-05T17:25:00.000Z', 134, 45,
   'conforme', 'conforme', 'conforme', 'u-002', 'u-003', '2026-08-06T08:55:00.000Z', 'Sin novedades.'),
  ('ciclo-002', '2026-0431', 'eq-001', 'vapor_134', '2026-08-09T15:05:00.000Z', '2026-08-09T16:35:00.000Z', 134, 45,
   'conforme', 'conforme', 'pendiente', 'u-002', NULL, NULL, 'Biologico en incubacion, lectura a las 24h.');

INSERT INTO ciclo_caja (ciclo_id, caja_id, vence_el) VALUES
  ('ciclo-001', 'caja-001', '2026-11-15T00:00:00.000Z'),
  ('ciclo-002', 'caja-002', NULL);

-- ---------------------------------------------------------------------------
-- Movimientos: el historial real. Cada INSERT dispara los triggers de
-- validacion y mueve caja.estado.
-- ---------------------------------------------------------------------------

-- caja-001 (LAP-01): ciclo completo con control biologico conforme.
-- Termina liberada en el deposito esteril.
INSERT INTO movimiento_caja (id, caja_id, estado_desde, estado_hasta, usuario_id, ciclo_id, ocurrido_en, observacion) VALUES
  ('mov-001', 'caja-001', 'esteril_deposito',  'en_lavado',         'u-002', NULL,        '2026-08-05T14:00:00.000Z', 'Rotacion preventiva'),
  ('mov-002', 'caja-001', 'en_lavado',         'en_armado',         'u-002', NULL,        '2026-08-05T15:20:00.000Z', NULL),
  ('mov-003', 'caja-001', 'en_armado',         'en_esterilizacion', 'u-002', 'ciclo-001', '2026-08-05T16:00:00.000Z', NULL),
  ('mov-004', 'caja-001', 'en_esterilizacion', 'en_cuarentena',     'u-002', 'ciclo-001', '2026-08-05T17:30:00.000Z', NULL),
  ('mov-005', 'caja-001', 'en_cuarentena',     'esteril_deposito',  'u-003', 'ciclo-001', '2026-08-06T09:00:00.000Z', 'Liberada por supervisor');

-- caja-002 (LAP-02): quedo en cuarentena, el biologico del ciclo-002 sigue pendiente.
INSERT INTO movimiento_caja (id, caja_id, estado_desde, estado_hasta, usuario_id, ciclo_id, ocurrido_en, observacion) VALUES
  ('mov-006', 'caja-002', 'esteril_deposito',  'en_lavado',         'u-002', NULL,        '2026-08-09T13:00:00.000Z', NULL),
  ('mov-007', 'caja-002', 'en_lavado',         'en_armado',         'u-002', NULL,        '2026-08-09T14:10:00.000Z', NULL),
  ('mov-008', 'caja-002', 'en_armado',         'en_esterilizacion', 'u-002', 'ciclo-002', '2026-08-09T15:00:00.000Z', NULL),
  ('mov-009', 'caja-002', 'en_esterilizacion', 'en_cuarentena',     'u-002', 'ciclo-002', '2026-08-09T16:40:00.000Z', NULL);

-- caja-004 (GEN-02): recorrido completo de una cirugia. Quedo sucia esperando lavado.
INSERT INTO movimiento_caja (id, caja_id, estado_desde, estado_hasta, usuario_id, cirugia_id, ocurrido_en, observacion) VALUES
  ('mov-010', 'caja-004', 'esteril_deposito', 'asignada',     'u-001', 'cir-001', '2026-08-08T09:12:00.000Z', 'Preparada para Q3'),
  ('mov-011', 'caja-004', 'asignada',         'en_quirofano', 'u-001', 'cir-001', '2026-08-08T10:50:00.000Z', NULL),
  ('mov-012', 'caja-004', 'en_quirofano',     'usada_sucia',  'u-001', 'cir-001', '2026-08-08T12:40:00.000Z', 'Fin de cirugia');

-- caja-006 (OBS-01): recien ingresada a la central.
INSERT INTO movimiento_caja (id, caja_id, estado_desde, estado_hasta, usuario_id, ocurrido_en, observacion) VALUES
  ('mov-013', 'caja-006', 'esteril_deposito', 'en_lavado', 'u-002', '2026-08-10T08:30:00.000Z', NULL);

-- caja-007 (GEN-03): esperando en mesa de armado.
INSERT INTO movimiento_caja (id, caja_id, estado_desde, estado_hasta, usuario_id, ocurrido_en, observacion) VALUES
  ('mov-014', 'caja-007', 'esteril_deposito', 'en_lavado', 'u-002', '2026-08-10T07:45:00.000Z', NULL),
  ('mov-015', 'caja-007', 'en_lavado',        'en_armado', 'u-002', '2026-08-10T09:05:00.000Z', NULL);

-- caja-008 (LAP-03): falta una pieza, esta en reparacion.
INSERT INTO movimiento_caja (id, caja_id, estado_desde, estado_hasta, usuario_id, ocurrido_en, observacion) VALUES
  ('mov-016', 'caja-008', 'esteril_deposito', 'en_lavado',     'u-002', '2026-08-07T11:00:00.000Z', NULL),
  ('mov-017', 'caja-008', 'en_lavado',        'en_armado',     'u-002', '2026-08-07T12:15:00.000Z', NULL),
  ('mov-018', 'caja-008', 'en_armado',        'en_reparacion', 'u-002', '2026-08-07T12:40:00.000Z', 'Falta un trocar de 12mm, optica con rayadura');

-- El vencimiento de esterilidad lo fija la liberacion del ciclo, no el escaneo.
-- (En la fase 4 esto lo hace el endpoint de liberacion.)
UPDATE caja SET vence_el = '2026-11-15T00:00:00.000Z' WHERE id = 'caja-001';
UPDATE caja SET vence_el = '2026-10-20T00:00:00.000Z' WHERE id IN ('caja-003', 'caja-005');
