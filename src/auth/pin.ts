/**
 * Derivacion y verificacion del PIN.
 *
 * El PIN es de 4 a 6 digitos porque se tipea con guantes y apurado: el espacio
 * de claves es de 10^4 a 10^6, chico. Eso NO se compensa con el hash, se
 * compensa con el bloqueo por intentos fallidos (usuario.intentos_fallidos /
 * bloqueado_hasta) y con exigir seleccion explicita de usuario antes del PIN:
 * nunca "buscar que usuario tiene este PIN".
 *
 * PBKDF2-SHA256 via WebCrypto: bcrypt y argon2 no corren nativo en Workers.
 */

const ALGORITMO = 'pbkdf2';
const HASH = 'sha256';

/**
 * Tope del runtime de Workers: por encima de 100.000 iteraciones, WebCrypto
 * responde `NotSupportedError: iteration counts above 100000 are not supported`.
 * No es configurable.
 *
 * Queda por debajo de la recomendacion de OWASP (210.000), y conviene ser
 * honesto sobre lo que eso significa aca: con un PIN de 4 a 6 digitos el
 * espacio de claves es de 10^4 a 10^6, asi que quien consiga los hashes los
 * rompe por fuerza bruta con 100.000 iteraciones o con 210.000. Lo que hace
 * que el PIN sea aceptable no son las iteraciones, es el bloqueo tras cinco
 * intentos fallidos (ver servicios/usuarios.ts).
 */
export const MAX_ITERACIONES_WORKERS = 100_000;

const ITERACIONES = MAX_ITERACIONES_WORKERS;
const LARGO_SALT = 16;
const LARGO_CLAVE = 32;

export const PIN_REGEX = /^\d{4,6}$/;

function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function desdeBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function derivar(pin: string, salt: Uint8Array, iteraciones: number): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iteraciones, hash: 'SHA-256' },
    clave,
    LARGO_CLAVE * 8,
  );
  return new Uint8Array(bits);
}

/** Devuelve `pbkdf2$sha256$<iteraciones>$<salt_b64>$<hash_b64>`. */
export async function hashPin(pin: string): Promise<string> {
  if (!PIN_REGEX.test(pin)) throw new Error('El PIN debe tener entre 4 y 6 digitos');
  const salt = crypto.getRandomValues(new Uint8Array(LARGO_SALT));
  const derivado = await derivar(pin, salt, ITERACIONES);
  return [ALGORITMO, HASH, ITERACIONES, aBase64(salt), aBase64(derivado)].join('$');
}

/** Comparacion en tiempo constante: no filtra cuantos bytes coincidieron. */
function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferencia === 0;
}

export async function verificarPin(pin: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split('$');
  if (partes.length !== 5) return false;
  const [algoritmo, hash, iteracionesTexto, saltB64, hashB64] = partes as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (algoritmo !== ALGORITMO || hash !== HASH) return false;

  const iteraciones = Number.parseInt(iteracionesTexto, 10);
  if (!Number.isSafeInteger(iteraciones) || iteraciones < 1) return false;

  // Un hash generado con más iteraciones de las que el runtime admite no se
  // puede verificar: en Workers dispararía un NotSupportedError, y en local
  // bloquearía el proceso durante minutos. Devolverlo como falso es la
  // respuesta correcta: el ingreso falla como PIN incorrecto y el admin puede
  // blanquearlo desde la pantalla de usuarios.
  if (iteraciones > MAX_ITERACIONES_WORKERS) return false;

  try {
    const derivado = await derivar(pin, desdeBase64(saltB64), iteraciones);
    return igualesEnTiempoConstante(derivado, desdeBase64(hashB64));
  } catch {
    // Cualquier otro error inesperado (salt malformado, etc.) falla igual:
    // PIN incorrecto, no 500.
    return false;
  }
}
