import type { EstadoCirugia } from './estados';

/**
 * Ciclo de vida de una cirugia.
 *
 * `suspendida` no es terminal: una cirugia suspendida se reprograma, y cuando
 * eso pasa vuelve a `programada` en vez de crear una cirugia nueva. Si se
 * creara una nueva se perderia el vinculo con las cajas que ya se habian
 * preparado y con el paciente.
 */
export const TRANSICIONES_CIRUGIA: Readonly<Record<EstadoCirugia, readonly EstadoCirugia[]>> = {
  programada: ['preparada', 'suspendida'],
  preparada: ['en_curso', 'programada', 'suspendida'],
  en_curso: ['finalizada', 'suspendida'],
  finalizada: [],
  suspendida: ['programada'],
};

export function esTransicionCirugiaValida(desde: EstadoCirugia, hasta: EstadoCirugia): boolean {
  return TRANSICIONES_CIRUGIA[desde].includes(hasta);
}
