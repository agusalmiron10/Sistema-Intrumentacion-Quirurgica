import { leerSesion } from './sesion';

/** El servidor no contesta: es un problema de red, no un rechazo. */
export class SinRed extends Error {
  constructor() {
    super('Sin conexion con el servidor');
    this.name = 'SinRed';
  }
}

/** El servidor contesto, pero con un error. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly cuerpo: unknown,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

interface Opciones {
  metodo?: string;
  cuerpo?: unknown;
  conSesion?: boolean;
}

export async function pedir<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const cabeceras: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

  if (opciones.conSesion !== false) {
    const sesion = leerSesion();
    if (sesion) cabeceras['Authorization'] = `Bearer ${sesion.token}`;
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: opciones.metodo ?? 'GET',
      headers: cabeceras,
      ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
    });
  } catch {
    // fetch solo rechaza por problemas de red. Un 4xx o 5xx llega como
    // respuesta normal y se maneja mas abajo.
    throw new SinRed();
  }

  const texto = await respuesta.text();

  // Un 500 puede venir con cuerpo de texto plano. Si se asume JSON y se
  // parsea a ciegas, el error del servidor se convierte en un SyntaxError
  // opaco y la pantalla termina mostrando un mensaje generico que no dice
  // nada. Paso por esto una vez y no quiero volver a pasar.
  let cuerpo: unknown = null;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = { mensaje: texto.slice(0, 300) };
    }
  }

  if (!respuesta.ok) {
    const mensaje =
      (cuerpo as { mensaje?: string } | null)?.mensaje ?? `Error ${respuesta.status}`;
    throw new ErrorApi(respuesta.status, cuerpo, mensaje);
  }

  return cuerpo as T;
}

export function hayRed(): boolean {
  return navigator.onLine;
}
