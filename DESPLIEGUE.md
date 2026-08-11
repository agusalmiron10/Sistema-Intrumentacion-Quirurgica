# Despliegue

## Estado actual

**Desplegado:** https://instrumentacion.instrumentacion-quirurgica-ximena.workers.dev

- Base D1 `instrumentacion` creada, con las migraciones aplicadas (`database_id` ya está en `wrangler.toml`).
- `SESION_SECRET` cargado como secret de Cloudflare, generado al azar.
- La base de producción está **vacía a propósito**: el seed de desarrollo no se cargó. Falta dar de alta usuarios e inventario (pasos 3 y 4).

Para volver a desplegar después de un cambio: `npm run deploy`.

Los dos pasos que siguen necesitan tu sesión de GitHub y la de Cloudflare, así
que los corrés vos. Todo lo demás ya está listo en el repositorio.

## 1. Subir a GitHub

El remote ya está configurado. Desde la carpeta del proyecto:

```bash
git push -u origin master
```

Si GitHub te pide autenticarte, la vía recomendada es el
[GitHub CLI](https://cli.github.com/): `gh auth login` y después el `push` de
arriba.

### Antes de hacerlo público

- **No hay secretos en el repositorio.** `SESION_SECRET` no está en
  `wrangler.toml` a propósito (ver más abajo) y `.dev.vars` está en
  `.gitignore`.
- El `seed/seed.sql` tiene PINs de desarrollo conocidos (`1234`, `2345`…).
  Eso está bien porque son datos de prueba, pero **ese seed no va nunca a
  producción**.

## 2. Desplegar en Cloudflare

```bash
npx wrangler login
```

### Crear la base

```bash
npx wrangler d1 create instrumentacion
```

El comando devuelve un `database_id`. Hay que pegarlo en `wrangler.toml`,
reemplazando el `00000000-0000-0000-0000-000000000000`.

### Aplicar las migraciones

```bash
npx wrangler d1 migrations apply instrumentacion --remote
```

Esto crea el esquema, los triggers y la máquina de estados. **No cargues el
seed**: son datos de prueba con PINs públicos.

### Configurar el secreto de sesión

```bash
npx wrangler secret put SESION_SECRET
```

Te lo va a pedir por consola. Para generar uno:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

Por qué esto no está en `wrangler.toml`: en Cloudflare las vars y los secrets
comparten namespace. Si el nombre estuviera declarado en `[vars]`, **cada
`wrangler deploy` pisaría el secreto real con el valor del archivo**, y ese
archivo está en un repositorio público. Con el secreto conocido, cualquiera
puede firmar un token de sesión válido y entrar como supervisor.

El código falla cerrado: sin secreto no emite sesiones, y rechaza los valores de
ejemplo si detecta que es un despliegue real.

### Fijar el dominio público

En `wrangler.toml`, `DOMINIO_PUBLICO` tiene que ser la URL definitiva **antes de
imprimir el primer pliego de etiquetas**. Es lo que va adentro de cada QR:
cambiarlo después obliga a reimprimir todas las etiquetas.

Cuanto más corto, mejor lee una etiqueta gastada — está medido en el README.

### Desplegar

```bash
npm run deploy
```

Compila la PWA y sube el Worker con los assets. Un solo comando: la aplicación y
la API van en el mismo origen.

## 3. Cargar los usuarios reales

El seed de desarrollo no va a producción, así que hay que crear los usuarios a
mano. Para cada uno, generar el hash del PIN:

```bash
node --experimental-strip-types scripts/hash-pin.ts 4821
```

Imprime el `INSERT` listo para pegar. Después:

```bash
npx wrangler d1 execute instrumentacion --remote --command "INSERT INTO usuario ..."
```

El PIN en texto plano no queda guardado en ningún lado: solo viaja el hash.

Roles: `instrumentadora`, `esterilizacion`, `supervisor`, `admin`. La liberación
de un lote de esterilización exige `supervisor` o `admin`.

## 4. Cargar el inventario

Con la aplicación andando, por API o por SQL directo:

1. Tipos de instrumental (`instrumento_tipo`)
2. Equipos esterilizadores (`equipo_esterilizador`)
3. Cirujanos y procedimientos
4. Cajas, con su contenido esperado — `POST /api/cajas`
5. Descartables y sus lotes — `POST /api/stock/descartables` y
   `POST /api/stock/lotes`
6. Plantillas — `POST /api/plantillas`

Las cajas nacen en `esteril_deposito`. Si al arrancar alguna está sucia o en
proceso, se la lleva a su estado real con escaneos normales desde la PWA: no
hay forma de escribir el estado a mano, y esa es la idea.

Después ya se pueden imprimir las etiquetas con `POST /api/etiquetas` y pegarlas.

## Verificación después del deploy

```bash
curl https://TU-DOMINIO/api/salud
```

Tiene que devolver `{"ok":true,"transicionesCargadas":16}`. Si dice 0, faltó
aplicar las migraciones.

Probá también que la cámara abra desde un celular: necesita HTTPS, que
Cloudflare ya da.
