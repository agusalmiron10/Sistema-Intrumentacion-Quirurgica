-- Migracion manual (banda 0500+). Triggers: drizzle no los modela.
--
-- Todo lo que hace cumplir las reglas no negociables vive aca. Si un dia
-- alguien se conecta con `wrangler d1 execute` y escribe SQL a mano, estos
-- triggers son lo unico que lo detiene.
--
-- Codigos de error: los mensajes empiezan con un slug estable (`transicion_invalida:`,
-- `conflicto_estado:`, ...) para que la API pueda mapearlos a respuestas HTTP
-- sin parsear prosa.

-- ===========================================================================
-- 1. movimiento_caja es APPEND-ONLY
-- ===========================================================================

CREATE TRIGGER movimiento_caja_no_update
BEFORE UPDATE ON movimiento_caja
BEGIN
  SELECT RAISE(ABORT, 'append_only: movimiento_caja no admite UPDATE');
END;
--> statement-breakpoint

CREATE TRIGGER movimiento_caja_no_delete
BEFORE DELETE ON movimiento_caja
BEGIN
  SELECT RAISE(ABORT, 'append_only: movimiento_caja no admite DELETE');
END;
--> statement-breakpoint

-- ===========================================================================
-- 2. Validacion de la maquina de estados, BEFORE INSERT
--
-- Todos los triggers de validacion llevan la misma guarda:
--     NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id)
--
-- Sin ella la idempotencia se rompe. En SQLite los triggers BEFORE INSERT
-- corren ANTES de verificar la unicidad de la PK, y RAISE(ABORT) no lo
-- suprime la clausula OR IGNORE del INSERT. O sea: al reenviar un evento ya
-- aplicado (reintento despues de una desconexion), la validacion veria que
-- caja.estado ya avanzo y abortaria con "transicion invalida" en vez de
-- ignorarlo en silencio. Con la guarda, el evento repetido no dispara ninguna
-- validacion, choca contra la PK y OR IGNORE lo descarta, que es lo que
-- queremos.
-- ===========================================================================

-- 2.a El evento tiene que partir del estado actual real de la caja.
-- Es el chequeo que atrapa los eventos offline que llegaron tarde: la caja ya
-- avanzo por otro camino y este escaneo quedo obsoleto. La API devuelve esto
-- como conflicto para mostrarselo a la usuaria, nunca lo descarta.
CREATE TRIGGER mc_val_estado_desde
BEFORE INSERT ON movimiento_caja
WHEN NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id)
 AND NEW.estado_desde IS NOT (SELECT estado FROM caja WHERE id = NEW.caja_id)
BEGIN
  SELECT RAISE(ABORT, 'conflicto_estado: el estado_desde del evento no coincide con el estado actual de la caja');
END;
--> statement-breakpoint

-- 2.b La arista tiene que existir en la maquina de estados.
CREATE TRIGGER mc_val_transicion
BEFORE INSERT ON movimiento_caja
WHEN NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id)
 AND NOT EXISTS (
       SELECT 1 FROM transicion_valida t
        WHERE t.estado_desde = NEW.estado_desde
          AND t.estado_hasta = NEW.estado_hasta
     )
BEGIN
  SELECT RAISE(ABORT, 'transicion_invalida: esa transicion de estado no existe en la maquina de estados');
END;
--> statement-breakpoint

-- 2.c Una caja con la esterilidad vencida no se puede asignar.
-- Se compara contra ocurrido_en y no contra la hora del servidor: un escaneo
-- offline de anteayer no puede fallar hoy por un vencimiento que en su
-- momento todavia no habia pasado.
CREATE TRIGGER mc_val_vigencia
BEFORE INSERT ON movimiento_caja
WHEN NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id)
 AND NEW.estado_hasta = 'asignada'
 AND EXISTS (
       SELECT 1 FROM caja c
        WHERE c.id = NEW.caja_id
          AND c.vence_el IS NOT NULL
          AND c.vence_el < NEW.ocurrido_en
     )
BEGIN
  SELECT RAISE(ABORT, 'caja_vencida: la esterilidad de la caja vencio antes del momento del escaneo');
END;
--> statement-breakpoint

-- 2.d Una caja dada de baja o inactiva no se puede asignar.
CREATE TRIGGER mc_val_caja_activa
BEFORE INSERT ON movimiento_caja
WHEN NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id)
 AND NEW.estado_hasta = 'asignada'
 AND EXISTS (SELECT 1 FROM caja c WHERE c.id = NEW.caja_id AND c.activa = 0)
BEGIN
  SELECT RAISE(ABORT, 'caja_inactiva: la caja esta dada de baja y no se puede asignar');
END;
--> statement-breakpoint

-- 2.e REGLA CRITICA: de cuarentena al deposito esteril solo con control
-- biologico conforme.
-- El ciclo se resuelve por el ciclo_caja mas reciente de esa caja y no por
-- NEW.ciclo_id, que es opcional y un cliente podria omitir o falsear.
CREATE TRIGGER mc_val_control_biologico
BEFORE INSERT ON movimiento_caja
WHEN NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id)
 AND NEW.estado_desde = 'en_cuarentena'
 AND NEW.estado_hasta = 'esteril_deposito'
 AND (
       SELECT ce.control_biologico
         FROM ciclo_caja cc
         JOIN ciclo_esterilizacion ce ON ce.id = cc.ciclo_id
        WHERE cc.caja_id = NEW.caja_id
        ORDER BY ce.iniciado_en DESC, ce.rowid DESC
        LIMIT 1
     ) IS NOT 'conforme'
BEGIN
  SELECT RAISE(ABORT, 'control_biologico_no_conforme: la caja no puede salir de cuarentena sin control biologico conforme');
END;
--> statement-breakpoint

-- ===========================================================================
-- 3. El INSERT es la UNICA via para cambiar caja.estado
-- ===========================================================================

CREATE TRIGGER mc_aplica_estado
AFTER INSERT ON movimiento_caja
BEGIN
  UPDATE caja
     SET estado = NEW.estado_hasta,
         -- Cada entrada al autoclave cuenta un ciclo de vida de la caja.
         ciclos_totales = ciclos_totales
                        + (CASE WHEN NEW.estado_hasta = 'en_esterilizacion' THEN 1 ELSE 0 END)
   WHERE id = NEW.caja_id;
END;
--> statement-breakpoint

-- Cierra la puerta trasera: `UPDATE caja SET estado = ...` por SQL directo
-- aborta. Solo pasa el UPDATE que dispara el trigger de arriba, que se
-- reconoce porque el movimiento que lo justifica es el ULTIMO insertado para
-- esa caja (rowid maximo = orden de insercion).
CREATE TRIGGER caja_estado_solo_por_movimiento
BEFORE UPDATE OF estado ON caja
WHEN NEW.estado IS NOT OLD.estado
 AND NOT EXISTS (
       SELECT 1 FROM movimiento_caja m
        WHERE m.rowid = (SELECT MAX(rowid) FROM movimiento_caja WHERE caja_id = NEW.id)
          AND m.caja_id     = NEW.id
          AND m.estado_desde = OLD.estado
          AND m.estado_hasta = NEW.estado
     )
BEGIN
  SELECT RAISE(ABORT, 'estado_no_modificable: caja.estado solo cambia por INSERT en movimiento_caja');
END;
--> statement-breakpoint

-- ===========================================================================
-- 4. Stock: mismo patron que las cajas
--    movimiento_stock es el log; lote_descartable.cantidad_actual es la
--    desnormalizacion que se mantiene sola.
-- ===========================================================================

CREATE TRIGGER movimiento_stock_no_update
BEFORE UPDATE ON movimiento_stock
BEGIN
  SELECT RAISE(ABORT, 'append_only: movimiento_stock no admite UPDATE');
END;
--> statement-breakpoint

CREATE TRIGGER movimiento_stock_no_delete
BEFORE DELETE ON movimiento_stock
BEGIN
  SELECT RAISE(ABORT, 'append_only: movimiento_stock no admite DELETE');
END;
--> statement-breakpoint

-- No se puede consumir mas de lo que hay en el lote.
CREATE TRIGGER ms_val_saldo
BEFORE INSERT ON movimiento_stock
WHEN NOT EXISTS (SELECT 1 FROM movimiento_stock WHERE id = NEW.id)
 AND (
      (NEW.tipo IN ('consumo', 'vencido')
        AND (SELECT cantidad_actual FROM lote_descartable WHERE id = NEW.lote_id) < NEW.cantidad)
      OR
      (NEW.tipo = 'ajuste' AND NEW.cantidad < 0
        AND (SELECT cantidad_actual FROM lote_descartable WHERE id = NEW.lote_id) < -NEW.cantidad)
     )
BEGIN
  SELECT RAISE(ABORT, 'stock_insuficiente: el lote no tiene saldo para este movimiento');
END;
--> statement-breakpoint

CREATE TRIGGER ms_aplica_saldo
AFTER INSERT ON movimiento_stock
BEGIN
  UPDATE lote_descartable
     SET cantidad_actual = cantidad_actual
                         + CASE NEW.tipo
                             WHEN 'consumo' THEN -NEW.cantidad
                             WHEN 'vencido' THEN -NEW.cantidad
                             ELSE NEW.cantidad   -- ingreso, devolucion, ajuste (firmado)
                           END
   WHERE id = NEW.lote_id;
END;
--> statement-breakpoint

-- Misma puerta trasera cerrada que en caja.estado: el saldo solo puede
-- moverse exactamente en el delta del ultimo movimiento del lote.
CREATE TRIGGER lote_saldo_solo_por_movimiento
BEFORE UPDATE OF cantidad_actual ON lote_descartable
WHEN NEW.cantidad_actual IS NOT OLD.cantidad_actual
 AND NEW.cantidad_actual IS NOT (
       OLD.cantidad_actual + (
         SELECT CASE m.tipo
                  WHEN 'consumo' THEN -m.cantidad
                  WHEN 'vencido' THEN -m.cantidad
                  ELSE m.cantidad
                END
           FROM movimiento_stock m
          WHERE m.lote_id = NEW.id
          ORDER BY m.rowid DESC
          LIMIT 1
       )
     )
BEGIN
  SELECT RAISE(ABORT, 'saldo_no_modificable: lote_descartable.cantidad_actual solo cambia por INSERT en movimiento_stock');
END;
--> statement-breakpoint

-- ===========================================================================
-- 5. Los controles de un ciclo no se reescriben
-- ===========================================================================

CREATE TRIGGER ciclo_control_biologico_inmutable
BEFORE UPDATE OF control_biologico ON ciclo_esterilizacion
WHEN OLD.control_biologico <> 'pendiente'
 AND NEW.control_biologico IS NOT OLD.control_biologico
BEGIN
  SELECT RAISE(ABORT, 'control_ya_registrado: el control biologico no se puede reescribir');
END;
