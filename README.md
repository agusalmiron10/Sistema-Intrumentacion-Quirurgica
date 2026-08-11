# Sistema de instrumentación quirúrgica

Gestión y trazabilidad de instrumental quirúrgico: cajas que circulan en ciclo
cerrado (depósito estéril → cirugía → lavado → armado → esterilización →
cuarentena → depósito estéril), ciclos de esterilización con control biológico,
y descartables por lote con consumo FEFO.

El requisito central no es el stock, es la trazabilidad: si un control biológico
sale no conforme, el sistema tiene que responder en segundos qué cajas estaban
en ese lote y en qué pacientes se usaron.

## Stack

Cloudflare Workers · D1 (SQLite) · Hono · Drizzle · TypeScript estricto · Zod ·
Vitest sobre Miniflare.

## Estado

- **Fase 1 — Base.** Esquema completo, migraciones, triggers de inmutabilidad y
  de máquina de estados, seed y tests. ✅
- Fase 2 — Cajas y QR. Pendiente.
- Fase 3 — Escaneo (PWA, cámara, PIN, cola offline). Pendiente.
- Fase 4 — Esterilización. Pendiente.
- Fase 5 — Plantillas y cirugías. Pendiente.
- Fase 6 — Stock FEFO. Pendiente.
- Fase 7 — Reportes Excel. Pendiente.

## Puesta en marcha

```bash
npm install
```

```bash
npm run db:reset:local
```

`db:reset:local` borra la base D1 local, aplica todas las migraciones y carga el
seed. Después:

```bash
npm run dev
```

```bash
npm test
```

Para producción hay que crear la base y pegar el `database_id` real en
`wrangler.toml`:

```bash
npx wrangler d1 create instrumentacion
```

## Cómo está organizado

```
src/
  dominio/estados.ts   Vocabulario y máquina de estados (definición canónica en TS)
  db/schema.ts         Esquema Drizzle
  db/index.ts          Cliente
  auth/pin.ts          Derivación y verificación del PIN (PBKDF2 vía WebCrypto)
  api/errores.ts       Traducción de abortos de trigger a respuestas HTTP
  index.ts             Worker (Hono)
migrations/            SQL aplicado por `wrangler d1 migrations apply`
seed/seed.sql          Datos de prueba realistas
test/                  Vitest contra una D1 real sobre Miniflare
```

### Numeración de migraciones

- **0000–0499**: generadas por `drizzle-kit generate`. Numera según su propio
  `meta/_journal.json`.
- **0500 en adelante**: escritas a mano (triggers, datos de catálogo). Drizzle
  nunca las pisa porque no las conoce.

Cuidado con una trampa de SQLite: cuando `drizzle-kit` necesita recrear una
tabla para alterarla, los triggers de esa tabla se pierden. Después de una
migración generada que recree tablas hay que volver a crear los triggers
afectados en una migración nueva de la banda 0500.

## Decisiones de diseño

### El log es la fuente de verdad

`movimiento_caja` es append-only: `UPDATE` y `DELETE` abortan por trigger, sin
excepciones ni bypass. `caja.estado` es una desnormalización que se mantiene
sola desde un `AFTER INSERT`, y un `UPDATE` directo sobre esa columna también
aborta. La única forma de mover una caja es insertar un evento.

Lo mismo, simétricamente, para el stock: `movimiento_stock` es el log,
`lote_descartable.cantidad_actual` es la desnormalización. Un contador que se
pueda escribir a mano se desincroniza; este no se puede escribir a mano.

### La máquina de estados vive en la base

La tabla `transicion_valida` tiene las aristas permitidas y un trigger
`BEFORE INSERT` rechaza cualquier otra. Habilitar una transición nueva es un
`INSERT`, no un cambio de código. `src/dominio/estados.ts` mantiene la copia en
TypeScript para dar feedback inmediato en el cliente, y un test verifica que
ambas definiciones coincidan exactamente.

### La guarda de idempotencia en los triggers

Todos los triggers de validación llevan:

```sql
WHEN NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE id = NEW.id) AND ...
```

Sin eso la idempotencia se rompe. En SQLite los triggers `BEFORE INSERT` corren
**antes** de verificar la unicidad de la clave primaria, y `RAISE(ABORT)` no lo
suprime la cláusula `OR IGNORE` del `INSERT`. Al reenviar un evento ya aplicado
—el reintento normal después de una desconexión— la validación vería que la caja
ya avanzó y abortaría con "transición inválida", mostrándole a la usuaria un
conflicto que no existe. Con la guarda, el evento repetido no dispara ninguna
validación, choca contra la PK y `OR IGNORE` lo descarta.

Lo que la guarda **no** hace es tapar errores reales: un evento nuevo con una
transición ilegal sigue abortando. Hay un test para cada mitad.

### Eventos offline

`ocurrido_en` lo manda el cliente (momento real del escaneo), `registrado_en` lo
pone el servidor. Pueden diferir por horas.

De ahí salen dos decisiones:

- El vencimiento de una caja se compara contra `ocurrido_en`, no contra la hora
  del servidor. Un escaneo de anteayer no puede fallar hoy por un vencimiento
  que en su momento todavía no había pasado.
- Si el `estado_desde` del evento no coincide con el estado actual de la caja,
  la base aborta con `conflicto_estado` (HTTP 409). Al sincronizar, ese conflicto
  se le muestra a la usuaria; nunca se descarta en silencio.

Cuando llegue la fase 3: el endpoint de sincronización tiene que aplicar el lote
de eventos **ordenado por `ocurrido_en`**, no en el orden en que llegan. Dos
escaneos encolados juntos (`en_lavado`, después `en_armado`) fallan si se
aplican al revés.

### Cambios sobre la especificación original

Cinco, todos acordados antes de escribir el esquema:

1. **Guarda de idempotencia en los triggers de validación** — explicada arriba.
2. **Protección del `UPDATE` sobre `caja.estado`** — sin ella el criterio "ni
   siquiera con SQL directo" no se cumplía para el estado desnormalizado.
3. **Transición `asignada → en_lavado`** — sin esta arista era imposible retirar
   del circuito una caja de un lote contaminado que ya estaba asignada a una
   cirugía. Una caja que ya está `en_quirofano` no se fuerza: sigue su curso
   natural y la cirugía queda marcada como afectada.
4. **`movimiento_stock` append-only con `cantidad_actual` por trigger** — por
   simetría con las cajas, y porque la regla "nunca un contador suelto" exigía
   que el saldo fuera derivado y no escribible.
5. **Tabla `cirugia_descartable`** — `plantilla_descartable` no tenía dónde
   congelarse al crear una cirugía. Sin ella no se podía comparar planificado
   contra consumido ni reconstruir el histórico si la plantilla cambiaba.

### Autenticación por PIN

El PIN es de 4 a 6 dígitos porque se tipea con guantes y apurado: el espacio de
claves es de 10⁴ a 10⁶, chico. Eso no se compensa con el hash, se compensa con
tres cosas: PBKDF2-SHA256 de 210.000 iteraciones vía WebCrypto (bcrypt y argon2
no corren nativo en Workers), bloqueo por intentos fallidos
(`usuario.intentos_fallidos` / `bloqueado_hasta`), y selección explícita de
usuario antes del PIN — nunca "buscar qué usuario tiene este PIN".

### Sobre `PRAGMA foreign_keys`

D1 aplica las foreign keys por defecto y el pragma no es configurable desde el
cliente; lo único disponible es `PRAGMA defer_foreign_keys` dentro de una
transacción. No hay nada que activar.

## Tests

43 tests contra una D1 real sobre Miniflare. Testear triggers contra un mock no
verificaría nada: lo que se está probando es el comportamiento de SQLite.

Cubren: correspondencia entre la máquina de estados de la base y la del código,
el ciclo completo de una caja, transiciones ilegales, conflicto de estado por
eventos tardíos, idempotencia (incluido el reenvío después de que la caja
avanzó), vencimiento y escaneos offline, control biológico para salir de
cuarentena, inmutabilidad del log y del estado, saldos de stock y orden FEFO.

Aviso: desde la v0.21 el pool de Vitest ya no aísla el storage entre tests, así
que los datos persisten dentro de un archivo. Los helpers de `test/ayudas.ts`
son idempotentes y cada caso usa ids propios.

## Privacidad

El sistema no guarda datos clínicos. De un paciente solo existe `paciente_ref`,
un identificador opaco. Sin nombre, sin documento, sin diagnóstico.
