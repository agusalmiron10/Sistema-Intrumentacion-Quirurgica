import type { Context } from 'hono';

/**
 * Dominio publico que se imprime adentro del QR.
 *
 * En produccion tiene que venir de la variable DOMINIO_PUBLICO: si se dedujera
 * del request, un pliego generado desde una URL de preview quedaria impreso
 * con esa URL para siempre. El fallback al origen del request existe solo para
 * que `wrangler dev` funcione sin configurar nada.
 */
export function dominioPublico(c: Context<{ Bindings: Cloudflare.Env }>): string {
  const configurado = c.env.DOMINIO_PUBLICO?.trim();
  if (configurado) return configurado.replace(/\/+$/, '');
  return new URL(c.req.url).origin;
}
