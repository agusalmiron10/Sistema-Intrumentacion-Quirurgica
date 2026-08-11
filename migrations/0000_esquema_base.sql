CREATE TABLE `caja` (
	`id` text PRIMARY KEY NOT NULL,
	`codigo` text NOT NULL,
	`nombre` text NOT NULL,
	`servicio` text,
	`estado` text DEFAULT 'esteril_deposito' NOT NULL,
	`ubicacion` text,
	`vence_el` text,
	`ciclos_totales` integer DEFAULT 0 NOT NULL,
	`activa` integer DEFAULT 1 NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "caja_estado_ck" CHECK("estado" in ('esteril_deposito', 'asignada', 'en_quirofano', 'usada_sucia', 'en_lavado', 'en_armado', 'en_esterilizacion', 'en_cuarentena', 'en_reparacion', 'baja')),
	CONSTRAINT "caja_activa_ck" CHECK("activa" in (0, 1)),
	CONSTRAINT "caja_ciclos_ck" CHECK("ciclos_totales" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `caja_codigo_uq` ON `caja` (`codigo`);--> statement-breakpoint
CREATE INDEX `caja_estado_idx` ON `caja` (`estado`);--> statement-breakpoint
CREATE TABLE `caja_contenido` (
	`caja_id` text NOT NULL,
	`instrumento_tipo_id` text NOT NULL,
	`cantidad` integer NOT NULL,
	PRIMARY KEY(`caja_id`, `instrumento_tipo_id`),
	FOREIGN KEY (`caja_id`) REFERENCES `caja`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrumento_tipo_id`) REFERENCES `instrumento_tipo`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "caja_contenido_cantidad_ck" CHECK("cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE `ciclo_caja` (
	`ciclo_id` text NOT NULL,
	`caja_id` text NOT NULL,
	`vence_el` text,
	PRIMARY KEY(`ciclo_id`, `caja_id`),
	FOREIGN KEY (`ciclo_id`) REFERENCES `ciclo_esterilizacion`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`caja_id`) REFERENCES `caja`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ciclo_caja_caja_idx` ON `ciclo_caja` (`caja_id`);--> statement-breakpoint
CREATE TABLE `ciclo_esterilizacion` (
	`id` text PRIMARY KEY NOT NULL,
	`numero_lote` text NOT NULL,
	`equipo_id` text NOT NULL,
	`metodo` text NOT NULL,
	`iniciado_en` text NOT NULL,
	`finalizado_en` text,
	`temperatura_c` integer,
	`tiempo_min` integer,
	`control_fisico` text DEFAULT 'pendiente' NOT NULL,
	`control_quimico` text DEFAULT 'pendiente' NOT NULL,
	`control_biologico` text DEFAULT 'pendiente' NOT NULL,
	`operador_id` text NOT NULL,
	`liberado_por` text,
	`liberado_en` text,
	`observacion` text,
	FOREIGN KEY (`equipo_id`) REFERENCES `equipo_esterilizador`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operador_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`liberado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ciclo_metodo_ck" CHECK("metodo" in ('vapor_134', 'vapor_121', 'oxido_etileno', 'peroxido_plasma')),
	CONSTRAINT "ciclo_ctrl_fisico_ck" CHECK("control_fisico" in ('pendiente', 'conforme', 'no_conforme')),
	CONSTRAINT "ciclo_ctrl_quimico_ck" CHECK("control_quimico" in ('pendiente', 'conforme', 'no_conforme')),
	CONSTRAINT "ciclo_ctrl_biologico_ck" CHECK("control_biologico" in ('pendiente', 'conforme', 'no_conforme'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ciclo_numero_lote_uq` ON `ciclo_esterilizacion` (`numero_lote`);--> statement-breakpoint
CREATE INDEX `ciclo_control_biologico_idx` ON `ciclo_esterilizacion` (`control_biologico`);--> statement-breakpoint
CREATE TABLE `cirugia` (
	`id` text PRIMARY KEY NOT NULL,
	`paciente_ref` text NOT NULL,
	`procedimiento_id` text NOT NULL,
	`cirujano_id` text NOT NULL,
	`instrumentadora_id` text,
	`plantilla_id` text,
	`quirofano` text,
	`programada_para` text NOT NULL,
	`estado` text DEFAULT 'programada' NOT NULL,
	`notas` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`procedimiento_id`) REFERENCES `procedimiento`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cirujano_id`) REFERENCES `cirujano`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrumentadora_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plantilla_id`) REFERENCES `plantilla`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cirugia_estado_ck" CHECK("estado" in ('programada', 'preparada', 'en_curso', 'finalizada', 'suspendida'))
);
--> statement-breakpoint
CREATE INDEX `cirugia_programada_idx` ON `cirugia` (`programada_para`);--> statement-breakpoint
CREATE INDEX `cirugia_paciente_idx` ON `cirugia` (`paciente_ref`);--> statement-breakpoint
CREATE TABLE `cirugia_caja` (
	`cirugia_id` text NOT NULL,
	`caja_id` text NOT NULL,
	`usada` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`cirugia_id`, `caja_id`),
	FOREIGN KEY (`cirugia_id`) REFERENCES `cirugia`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`caja_id`) REFERENCES `caja`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cirugia_caja_usada_ck" CHECK("usada" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `cirugia_caja_caja_idx` ON `cirugia_caja` (`caja_id`);--> statement-breakpoint
CREATE TABLE `cirugia_descartable` (
	`cirugia_id` text NOT NULL,
	`descartable_id` text NOT NULL,
	`cantidad_planificada` integer NOT NULL,
	PRIMARY KEY(`cirugia_id`, `descartable_id`),
	FOREIGN KEY (`cirugia_id`) REFERENCES `cirugia`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`descartable_id`) REFERENCES `descartable`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cirugia_descartable_cantidad_ck" CHECK("cantidad_planificada" > 0)
);
--> statement-breakpoint
CREATE TABLE `cirujano` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`matricula` text NOT NULL,
	`especialidad` text,
	`notas` text,
	`activo` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cirujano_activo_ck" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cirujano_matricula_uq` ON `cirujano` (`matricula`);--> statement-breakpoint
CREATE TABLE `descartable` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`codigo` text NOT NULL,
	`unidad` text NOT NULL,
	`punto_reposicion` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "descartable_activo_ck" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `descartable_codigo_uq` ON `descartable` (`codigo`);--> statement-breakpoint
CREATE TABLE `equipo_esterilizador` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`marca` text,
	`ultima_validacion` text,
	`activo` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "equipo_activo_ck" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `instrumento_tipo` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`codigo` text NOT NULL,
	`fabricante` text,
	`termosensible` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "instrumento_tipo_termosensible_ck" CHECK("termosensible" in (0, 1)),
	CONSTRAINT "instrumento_tipo_activo_ck" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instrumento_tipo_codigo_uq` ON `instrumento_tipo` (`codigo`);--> statement-breakpoint
CREATE TABLE `lote_descartable` (
	`id` text PRIMARY KEY NOT NULL,
	`descartable_id` text NOT NULL,
	`numero_lote` text NOT NULL,
	`vence_el` text,
	`cantidad_inicial` integer DEFAULT 0 NOT NULL,
	`cantidad_actual` integer DEFAULT 0 NOT NULL,
	`recibido_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`descartable_id`) REFERENCES `descartable`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "lote_cantidad_actual_ck" CHECK("cantidad_actual" >= 0),
	CONSTRAINT "lote_cantidad_inicial_ck" CHECK("cantidad_inicial" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lote_descartable_uq` ON `lote_descartable` (`descartable_id`,`numero_lote`);--> statement-breakpoint
CREATE INDEX `lote_fefo_idx` ON `lote_descartable` (`descartable_id`,`vence_el`);--> statement-breakpoint
CREATE TABLE `movimiento_caja` (
	`id` text PRIMARY KEY NOT NULL,
	`caja_id` text NOT NULL,
	`estado_desde` text NOT NULL,
	`estado_hasta` text NOT NULL,
	`usuario_id` text NOT NULL,
	`cirugia_id` text,
	`ciclo_id` text,
	`ocurrido_en` text NOT NULL,
	`registrado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`observacion` text,
	`metadata` text,
	FOREIGN KEY (`caja_id`) REFERENCES `caja`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cirugia_id`) REFERENCES `cirugia`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ciclo_id`) REFERENCES `ciclo_esterilizacion`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "movimiento_desde_ck" CHECK("estado_desde" in ('esteril_deposito', 'asignada', 'en_quirofano', 'usada_sucia', 'en_lavado', 'en_armado', 'en_esterilizacion', 'en_cuarentena', 'en_reparacion', 'baja')),
	CONSTRAINT "movimiento_hasta_ck" CHECK("estado_hasta" in ('esteril_deposito', 'asignada', 'en_quirofano', 'usada_sucia', 'en_lavado', 'en_armado', 'en_esterilizacion', 'en_cuarentena', 'en_reparacion', 'baja'))
);
--> statement-breakpoint
CREATE INDEX `movimiento_caja_caja_idx` ON `movimiento_caja` (`caja_id`,`ocurrido_en`);--> statement-breakpoint
CREATE INDEX `movimiento_caja_cirugia_idx` ON `movimiento_caja` (`cirugia_id`);--> statement-breakpoint
CREATE INDEX `movimiento_caja_ciclo_idx` ON `movimiento_caja` (`ciclo_id`);--> statement-breakpoint
CREATE TABLE `movimiento_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`lote_id` text NOT NULL,
	`tipo` text NOT NULL,
	`cantidad` integer NOT NULL,
	`cirugia_id` text,
	`usuario_id` text NOT NULL,
	`ocurrido_en` text NOT NULL,
	`registrado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`motivo` text,
	FOREIGN KEY (`lote_id`) REFERENCES `lote_descartable`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cirugia_id`) REFERENCES `cirugia`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "movimiento_stock_tipo_ck" CHECK("tipo" in ('ingreso', 'consumo', 'devolucion', 'vencido', 'ajuste')),
	CONSTRAINT "movimiento_stock_cantidad_ck" CHECK(("tipo" = 'ajuste' and "cantidad" <> 0) or ("tipo" <> 'ajuste' and "cantidad" > 0))
);
--> statement-breakpoint
CREATE INDEX `movimiento_stock_lote_idx` ON `movimiento_stock` (`lote_id`,`ocurrido_en`);--> statement-breakpoint
CREATE INDEX `movimiento_stock_cirugia_idx` ON `movimiento_stock` (`cirugia_id`);--> statement-breakpoint
CREATE TABLE `plantilla` (
	`id` text PRIMARY KEY NOT NULL,
	`procedimiento_id` text NOT NULL,
	`cirujano_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`notas` text,
	`vigente` integer DEFAULT 1 NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`procedimiento_id`) REFERENCES `procedimiento`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cirujano_id`) REFERENCES `cirujano`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plantilla_vigente_ck" CHECK("vigente" in (0, 1)),
	CONSTRAINT "plantilla_version_ck" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `plantilla_resolucion_idx` ON `plantilla` (`procedimiento_id`,`cirujano_id`,`vigente`);--> statement-breakpoint
CREATE TABLE `plantilla_caja` (
	`plantilla_id` text NOT NULL,
	`caja_id` text NOT NULL,
	`obligatoria` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`plantilla_id`, `caja_id`),
	FOREIGN KEY (`plantilla_id`) REFERENCES `plantilla`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`caja_id`) REFERENCES `caja`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plantilla_caja_obligatoria_ck" CHECK("obligatoria" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `plantilla_descartable` (
	`plantilla_id` text NOT NULL,
	`descartable_id` text NOT NULL,
	`cantidad` integer NOT NULL,
	PRIMARY KEY(`plantilla_id`, `descartable_id`),
	FOREIGN KEY (`plantilla_id`) REFERENCES `plantilla`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`descartable_id`) REFERENCES `descartable`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plantilla_descartable_cantidad_ck" CHECK("cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE `procedimiento` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`codigo` text NOT NULL,
	`especialidad` text,
	`duracion_min` integer,
	`activo` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "procedimiento_activo_ck" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procedimiento_codigo_uq` ON `procedimiento` (`codigo`);--> statement-breakpoint
CREATE TABLE `transicion_valida` (
	`estado_desde` text NOT NULL,
	`estado_hasta` text NOT NULL,
	`descripcion` text,
	PRIMARY KEY(`estado_desde`, `estado_hasta`),
	CONSTRAINT "transicion_desde_ck" CHECK("estado_desde" in ('esteril_deposito', 'asignada', 'en_quirofano', 'usada_sucia', 'en_lavado', 'en_armado', 'en_esterilizacion', 'en_cuarentena', 'en_reparacion', 'baja')),
	CONSTRAINT "transicion_hasta_ck" CHECK("estado_hasta" in ('esteril_deposito', 'asignada', 'en_quirofano', 'usada_sucia', 'en_lavado', 'en_armado', 'en_esterilizacion', 'en_cuarentena', 'en_reparacion', 'baja'))
);
--> statement-breakpoint
CREATE TABLE `usuario` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`email` text NOT NULL,
	`pin_hash` text NOT NULL,
	`rol` text NOT NULL,
	`intentos_fallidos` integer DEFAULT 0 NOT NULL,
	`bloqueado_hasta` text,
	`activo` integer DEFAULT 1 NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "usuario_rol_ck" CHECK("rol" in ('instrumentadora', 'esterilizacion', 'supervisor', 'admin')),
	CONSTRAINT "usuario_activo_ck" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_email_uq` ON `usuario` (`email`);