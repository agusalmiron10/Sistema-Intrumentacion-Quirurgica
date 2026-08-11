import type { Context } from 'hono';
import type { z } from 'zod';

export interface ErrorValidacion {
  campo: string;
  mensaje: string;
}

export function detallesDeError(error: z.ZodError): ErrorValidacion[] {
  return error.issues.map((issue) => ({
    campo: issue.path.join('.') || '(raiz)',
    mensaje: issue.message,
  }));
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; respuesta: Response };

/** Lee y valida el cuerpo JSON. Devuelve la respuesta 400 ya armada si falla. */
export async function leerJson<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<Resultado<z.infer<T>>> {
  let crudo: unknown;
  try {
    crudo = await c.req.json();
  } catch {
    return {
      ok: false,
      respuesta: c.json({ error: 'json_invalido', mensaje: 'El cuerpo no es JSON valido' }, 400),
    };
  }

  const resultado = schema.safeParse(crudo);
  if (!resultado.success) {
    return {
      ok: false,
      respuesta: c.json({ error: 'validacion', detalles: detallesDeError(resultado.error) }, 400),
    };
  }
  return { ok: true, datos: resultado.data };
}

/** Igual pero para la query string. */
export function leerQuery<T extends z.ZodType>(c: Context, schema: T): Resultado<z.infer<T>> {
  const resultado = schema.safeParse(c.req.query());
  if (!resultado.success) {
    return {
      ok: false,
      respuesta: c.json({ error: 'validacion', detalles: detallesDeError(resultado.error) }, 400),
    };
  }
  return { ok: true, datos: resultado.data };
}
