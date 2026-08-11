/**
 * Identificadores de caja y normalizacion del codigo legible.
 *
 * El id de una caja viaja adentro del QR impreso, asi que su longitud decide
 * la densidad del codigo. Con un UUID v4 la URL queda en 77 caracteres y el QR
 * sale version 8 (49x49 modulos): a 20mm de lado eso da 0.41mm por modulo,
 * por debajo del piso practico para leer con la camara de un celular una
 * etiqueta rayada. Con 10 caracteres el QR baja a version 6 (41x41).
 *
 * El id tiene que ser opaco e inmutable (el codigo legible se puede
 * reetiquetar; el id no), no un secreto: quien tiene la caja en la mano ya
 * tiene la caja.
 */

/** Crockford base32: sin I, L, O ni U, para que no se confundan al leerlas. */
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO_ID = 10; // 32^10 = 2^50 combinaciones

export function nuevoIdCaja(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LARGO_ID));
  let id = '';
  for (const b of bytes) id += ALFABETO[b % ALFABETO.length];
  return id;
}

export const ID_CAJA_REGEX = new RegExp(`^[${ALFABETO}]{${LARGO_ID}}$`);

/**
 * Normaliza el codigo legible que se tipea a mano cuando la etiqueta esta
 * ilegible. Deliberadamente conservador: mayusculas, sin espacios sobrantes y
 * los espacios internos pasan a guion. Nada de correcciones "inteligentes"
 * (0 por O, 1 por I): con codigos cortos eso genera falsos positivos, y hacer
 * match con la caja equivocada es peor que no encontrarla.
 */
export function normalizarCodigo(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, '-');
}

/** URL que va adentro del QR. Nunca datos embebidos: si cambia algo, no se reimprime nada. */
export function urlDeCaja(dominio: string, cajaId: string): string {
  return `${dominio.replace(/\/+$/, '')}/c/${cajaId}`;
}

/**
 * Saca la referencia de caja de lo que sea que haya entrado: la URL de un QR,
 * un codigo tipeado a mano o lo que escupio la pistola lectora USB.
 *
 * Acepta el dominio que sea, no solo el propio: una etiqueta impresa hace dos
 * anios con el dominio viejo tiene que seguir sirviendo. Lo que importa es el
 * id, y el id no cambia.
 */
export function refDesdeTexto(texto: string): string {
  const limpio = texto.trim();
  if (!limpio) return '';

  const enUrl = /^https?:\/\/[^\s/]+\/c\/([^/?#\s]+)/i.exec(limpio);
  if (enUrl?.[1]) return decodeURIComponent(enUrl[1]);

  // Tambien se acepta pegar solo la parte final, tipo "/c/K7Q2M9XB4T".
  const relativa = /^\/c\/([^/?#\s]+)/.exec(limpio);
  if (relativa?.[1]) return decodeURIComponent(relativa[1]);

  return limpio;
}
