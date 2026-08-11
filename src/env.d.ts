/**
 * Secretos del Worker.
 *
 * Van declarados aca y no en wrangler.toml a proposito: `wrangler types` solo
 * genera lo que encuentra en la config, y poner el nombre en [vars] haria que
 * cada deploy pisara el secreto real con el valor del archivo (vars y secrets
 * comparten namespace en Cloudflare).
 *
 * Se cargan con `wrangler secret put <NOMBRE>` en produccion y con .dev.vars en
 * local.
 */
declare namespace Cloudflare {
  interface Env {
    /** Firma de los tokens de sesion. */
    SESION_SECRET: string;
  }
}
