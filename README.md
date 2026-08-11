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
- **Fase 2 — Cajas y QR.** CRUD de cajas y contenido esperado, generación de QR
  y pliego de etiquetas en PDF. ✅
- **Fase 3 — Escaneo.** PWA con cámara, modo continuo, entrada manual, PIN,
  cola offline y sincronización de eventos. ✅
- **Fase 4 — Esterilización.** Armado de ciclos, controles, liberación,
  cuarentena y recall automático ante control biológico no conforme. ✅
- **Fase 5 — Plantillas y cirugías.** Preference cards versionadas, creación de
  cirugías con resolución de plantilla y asignación de cajas. ✅
- **Fase 6 — Stock.** Descartables por lote, consumo FEFO, alertas de
  reposición y de vencimiento. ✅
- **Fase 7 — Reportes.** Exportación a Excel: stock, trazabilidad por cirugía,
  historial de una caja y productividad por ciclo. ✅

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

Eso levanta el Worker con la PWA ya compilada en `http://localhost:8787`. Para
trabajar sobre el frontend con recarga en caliente, en otra terminal:

```bash
npm run dev:web
```

PINs de desarrollo: Marcela `1234`, Silvia `2345`, Roberto `3456`, admin `9999`.

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
  dominio/estados.ts         Vocabulario y máquina de estados (definición canónica en TS)
  dominio/identificadores.ts Id corto de caja, normalización de código, URL del QR
  db/schema.ts               Esquema Drizzle
  db/index.ts                Cliente
  auth/pin.ts                Derivación y verificación del PIN (PBKDF2 vía WebCrypto)
  servicios/cajas.ts         CRUD y resolución por id o código
  servicios/qr.ts            Matriz del QR y SVG
  servicios/etiquetas.ts     Pliego de etiquetas en PDF
  servicios/ciclos.ts        Ciclos, controles, liberación y recall
  servicios/plantillas.ts    Preference cards versionadas
  servicios/cirugias.ts      Cirugías y trazabilidad
  servicios/stock.ts         Lotes, consumo FEFO y alertas
  servicios/reportes.ts      Exportación a Excel
  api/esquemas.ts            Validación Zod
  api/errores.ts             Traducción de errores de D1 a respuestas HTTP
  api/rutas/                 Routers de Hono
  index.ts                   Worker
migrations/                  SQL aplicado por `wrangler d1 migrations apply`
seed/seed.sql                Datos de prueba realistas
test/                        Vitest contra una D1 real sobre Miniflare
web/                         PWA (React + Vite), servida por el mismo Worker
  src/lib/almacen.ts         IndexedDB: cola, catálogo de cajas y conflictos
  src/lib/cola.ts            Encolado y sincronización
  src/lib/cajas.ts           Catálogo local y validación de transiciones
  src/pantallas/             Ingreso, Escaneo y Conflictos
```

`web/` importa `src/dominio/estados.ts` directamente: la máquina de estados del
cliente y la del servidor son el mismo archivo, y un test verifica que además
coincidan con la tabla `transicion_valida`.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/salud` | Diagnóstico |
| `GET` | `/api/usuarios` | Lista para la pantalla de ingreso (sin email ni hash) |
| `POST` | `/api/sesion` | Ingreso por PIN, devuelve el token |
| `GET` | `/api/sesion` | Verifica el token guardado |
| `POST` | `/api/eventos` | Sincroniza un lote de escaneos |
| `GET` | `/api/cajas` | Listado con filtros `estado`, `servicio`, `q`, `activa` |
| `POST` | `/api/cajas` | Alta, opcionalmente con contenido esperado |
| `GET` | `/api/cajas/:ref` | Detalle con contenido |
| `PATCH` | `/api/cajas/:ref` | Edita datos administrativos (nunca el estado) |
| `GET` | `/api/cajas/:ref/historial` | Movimientos de la caja |
| `GET` | `/api/cajas/:ref/contenido` | Contenido esperado |
| `PUT` | `/api/cajas/:ref/contenido` | Reemplaza el contenido esperado |
| `GET` | `/api/cajas/:ref/qr.svg` | QR individual |
| `POST` | `/api/etiquetas` | Pliego de etiquetas en PDF |
| `GET` | `/c/:id` | Destino del QR impreso |
| `GET` | `/api/ciclos` | Ciclos, filtrable por `controlBiologico` y `equipoId` |
| `POST` | `/api/ciclos` | Arma un ciclo con las cajas escaneadas |
| `GET` | `/api/ciclos/:ref` | Detalle con sus cajas (acepta id o número de lote) |
| `POST` | `/api/ciclos/:ref/finalizar` | Fin del ciclo: las cajas pasan a cuarentena |
| `POST` | `/api/ciclos/:ref/controles` | Carga de controles; el biológico no conforme dispara el recall |
| `POST` | `/api/ciclos/:ref/liberar` | Liberación (solo supervisor) |
| `GET` | `/api/ciclos/:ref/impacto` | Cajas y cirugías afectadas, sin escribir nada |
| `GET` | `/api/ciclos/equipos` | Esterilizadores activos |
| `GET` | `/api/plantillas` | Preference cards |
| `POST` | `/api/plantillas` | Crea una versión nueva |
| `GET` | `/api/plantillas/resolver` | Qué plantilla se aplicaría y de dónde sale |
| `GET` | `/api/cirugias` | Listado con filtros de fecha y estado |
| `POST` | `/api/cirugias` | Alta con la plantilla ya copiada |
| `GET` | `/api/cirugias/:id` | Detalle con cajas y descartables planificados |
| `POST` | `/api/cirugias/:id/estado` | Cambia el estado; `preparada` asigna las cajas |
| `POST` | `/api/cirugias/:id/consumir` | Descuenta lo planificado por FEFO |
| `GET` | `/api/cirugias/:id/trazabilidad` | Movimientos, ciclos y lotes consumidos |
| `GET` | `/api/stock` | Existencias por descartable |
| `GET` | `/api/stock/alertas` | Reposición, por vencer y vencidos |
| `POST` | `/api/stock/lotes` | Recepción de un lote |
| `POST` | `/api/stock/consumo` | Consumo FEFO |
| `POST` | `/api/stock/movimientos` | Devolución, ajuste o baja |
| `POST` | `/api/stock/descartar-vencidos` | Da de baja todo lo vencido con saldo |
| `GET` | `/api/reportes/stock` | Excel de stock |
| `GET` | `/api/reportes/cirugias/:id` | Excel de trazabilidad |
| `GET` | `/api/reportes/cajas/:ref` | Excel del historial de una caja |
| `GET` | `/api/reportes/ciclos` | Excel de productividad |

`:ref` acepta el id o el código legible, indistintamente y sin importar
mayúsculas. Las dos vías tienen que funcionar en todos lados: el QR trae el id y
la entrada manual —la etiqueta rayada, que es el caso común— trae el código.

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

### La longitud de la URL define si el QR se puede leer

El QR lleva una URL (`https://{dominio}/c/{caja_id}`), nunca datos embebidos: si
cambia algo, no se reimprimen 200 etiquetas. Pero la longitud de esa URL decide
la densidad del código, y ahí hay un límite físico:

| URL | módulos | módulo a 20mm | a 25mm |
|---|---|---|---|
| dominio largo + UUID | 49×49 | 0,41mm | 0,51mm |
| dominio largo + id corto | 41×41 | 0,49mm | 0,61mm |
| dominio corto + id corto | 33×33 | 0,61mm | 0,76mm |

Con un UUID y una etiqueta de 2cm el módulo queda en 0,41mm, por debajo del piso
práctico (~0,5mm) para lectura con cámara de celular — y con la etiqueta rayada,
que es el caso real, falla.

Por eso el id de caja es de 10 caracteres Crockford base32 (~2⁵⁰), opaco e
inmutable, y el lado por defecto del QR es 25mm en vez del mínimo de 20mm.
`DOMINIO_PUBLICO` conviene que sea corto: cada carácter de más engorda el código.

**Esa variable tiene que estar definida antes de imprimir el primer pliego.** Si
no está, se deduce del request, y un pliego generado desde una URL de preview
queda impreso con esa URL para siempre.

### El QR se dibuja como vectores, no como imagen

La matriz de módulos se pinta como rectángulos en el PDF, agrupando los módulos
contiguos de cada fila en una sola franja. Sale nítido a cualquier resolución de
impresora, no hace falta un canvas (que en Workers no existe) y el archivo pesa
poco: 8 etiquetas son 20KB.

Hay un test que decodifica el QR generado —rasterizado desde las mismas franjas
que dibuja el PDF— y verifica que vuelva exactamente a la URL de la caja. Es la
única forma de saber que el agrupado y la inversión de filas están bien; si
alguna de las dos se rompe, el código impreso deja de leerse.

### La PWA y la API van en el mismo origen

El pliego original decía Cloudflare Pages para el frontend. Va servido por el
mismo Worker, con `[assets]`, por una razón concreta: con Pages la PWA y la API
quedan en orígenes distintos, y eso obliga a resolver CORS y a manejar la sesión
con cookies cross-site — justo el tipo de cosa que falla en un navegador de
hospital con la configuración restringida. Mismo origen elimina el problema y
deja un solo deploy.

Un archivo inexistente devuelve 404 de verdad, no el `index.html`. Devolver el
index a un pedido de `/assets/algo.js` hace que el navegador reciba HTML donde
espera JavaScript, y el error que muestra no se parece en nada al problema real.
Pasa al desplegar una versión nueva mientras alguien tiene la app abierta: la
pestaña vieja sigue pidiendo los chunks anteriores.

### Offline: qué se guarda y por qué

En IndexedDB viven tres cosas:

- **La cola de escaneos sin sincronizar.** Un escaneo encolado es trabajo que la
  usuaria ya hizo; tiene que sobrevivir a que se recargue la página o se apague
  la tablet.
- **El catálogo de cajas.** Sin él no hay modo offline de verdad: para armar un
  evento hace falta saber de qué estado sale la caja, y eso no se adivina. Si se
  escanea una caja que no está en el catálogo local y no hay señal, se avisa en
  vez de encolar un evento mal construido.
- **Los conflictos.** Un escaneo rechazado no se descarta en silencio: alguien
  movió una caja de verdad y el sistema no lo registró.

El estado local se adelanta de forma optimista al encolar, para poder encadenar
escaneos sin señal (`en_lavado` y después `en_armado` sobre la misma caja). Al
sincronizar se reemplaza por lo que confirmó el servidor.

### Cada evento sabe quién lo hizo

El `usuarioId` viaja dentro del evento y no se deduce de la sesión. La cola
puede sincronizarse horas después, cuando en la tablet ya ingresó otra persona;
si se tomara el usuario de la sesión, esos escaneos quedarían a nombre de quien
no los hizo. El servidor rechaza con `usuario_distinto` los eventos que no
coinciden con la sesión, y el cliente los deja en la cola esperando a su dueño.
Cerrar sesión con la cola llena avisa antes.

### Relojes desfasados

Un evento con fecha futura se rechaza con `reloj_desfasado`. No es una rareza:
el orden de aplicación sale de `ocurrido_en` y el control de vencimiento se
compara contra ese mismo campo, así que una tablet con la fecha mal puesta
podría colar una caja vencida como vigente.

### El recall es la razón de ser del sistema

Cargar un control biológico como `no_conforme` no marca nada para revisar
después: retira el lote entero en el acto. Cada caja que se pueda retirar
vuelve a `en_lavado` con un movimiento real, se le anula el vencimiento, y la
respuesta trae la lista completa de cirugías afectadas — las que ya usaron una
caja del lote y las que la tienen comprometida.

Una caja que ya está `en_quirofano` no se fuerza. Forzarla por sistema no la
saca del campo quirúrgico: se reporta y sigue su curso normal.

El control biológico no se puede reescribir una vez cargado. Eso lo sostiene un
trigger, no la API.

### Las plantillas se versionan, no se editan

Al crear una cirugía se resuelve la plantilla (primero la del cirujano, si no la
genérica del procedimiento) y se **copia** a `cirugia_caja` y
`cirugia_descartable`. La copia no es una optimización: si mañana cambia la
preference card, el histórico tiene que seguir mostrando lo que realmente se
preparó para ese paciente. Hay un test que lo fija.

Por lo mismo, crear una versión nueva baja la anterior a `vigente = 0` pero no
la borra: las cirugías viejas la referencian.

### FEFO no es "consumir lo que vence antes" a secas

Dos cosas que parecen detalles y no lo son:

- **Un lote vencido nunca se consume.** FEFO significa consumir primero lo que
  vence antes, no consumir lo vencido. Eso no se usa en un paciente, se
  descarta. Los vencidos se cuentan aparte del disponible: sumarlos sería decir
  que hay stock de algo que no se puede usar.
- **En SQLite los `NULL` ordenan primero.** Sin cuidarlo, un lote sin fecha de
  vencimiento se consumiría antes que uno que vence la semana que viene.

Si no alcanza el stock no se consume nada: descontar a medias deja el stock
movido y la cirugía igual de incompleta. El error informa cuánto hay vencido sin
descartar, que es lo que explica por qué el número del sistema no cierra con lo
que se ve en el estante.

### Reportes

`exceljs` corre dentro de workerd —hay un smoke test que lo fija— y se importa
de forma diferida: pesa bastante y solo hace falta cuando alguien pide un
reporte. Cargarlo en el módulo raíz encarecería el arranque de todas las rutas,
incluidas las del escaneo, que son las que tienen que responder rápido.

El historial de una caja muestra `ocurrido_en` y `registrado_en` en columnas
separadas. La diferencia entre ambos es lo que revela que ese escaneo se hizo
sin señal y se sincronizó después.

Un test verifica que el reporte de cirugía no filtre datos clínicos: es el
archivo que se comparte por mail y se imprime, el lugar más fácil para que se
escape algo que el sistema no debería tener.

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

186 tests contra una D1 real sobre Miniflare. Testear triggers contra un mock no
verificaría nada: lo que se está probando es el comportamiento de SQLite.

Cubren: correspondencia entre la máquina de estados de la base y la del código,
el ciclo completo de una caja, transiciones ilegales, conflicto de estado por
eventos tardíos, idempotencia (incluido el reenvío después de que la caja
avanzó), vencimiento y escaneos offline, control biológico para salir de
cuarentena, inmutabilidad del log y del estado, saldos de stock y orden FEFO,
CRUD de cajas por API, round-trip de decodificación del QR, ingreso por PIN con
bloqueo, firma y vencimiento de los tokens, sincronización de eventos (orden
cronológico, idempotencia, conflictos, usuario distinto, reloj desfasado),
armado y liberación de ciclos, el recall completo ante control biológico no
conforme, versionado de plantillas, congelamiento de la plantilla en la
cirugía, consumo FEFO con lotes vencidos y sin stock, alertas, y generación de
los cuatro reportes de Excel verificando su contenido.

Aviso: desde la v0.21 el pool de Vitest ya no aísla el storage entre tests, así
que los datos persisten dentro de un archivo. Los helpers de `test/ayudas.ts`
son idempotentes y cada caso usa ids propios.

## Privacidad

El sistema no guarda datos clínicos. De un paciente solo existe `paciente_ref`,
un identificador opaco. Sin nombre, sin documento, sin diagnóstico.
