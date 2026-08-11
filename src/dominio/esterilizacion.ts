import type { MetodoEsterilizacion } from './estados';

/**
 * Vigencia de la esterilidad, en dias, desde la liberacion del ciclo.
 *
 * En la practica esto no depende del metodo sino del empaque y de la politica
 * del hospital (doble envoltorio, contenedor rigido, condiciones del deposito).
 * Por eso es un default y no una verdad: el endpoint de liberacion acepta
 * sobreescribirlo.
 */
export const DIAS_DE_VIGENCIA = 180;

/** Parametros minimos esperados por metodo, para avisar si algo salio raro. */
export const PARAMETROS_ESPERADOS: Readonly<
  Record<MetodoEsterilizacion, { temperaturaC: number | null; tiempoMinimoMin: number }>
> = {
  vapor_134: { temperaturaC: 134, tiempoMinimoMin: 4 },
  vapor_121: { temperaturaC: 121, tiempoMinimoMin: 15 },
  oxido_etileno: { temperaturaC: 55, tiempoMinimoMin: 180 },
  peroxido_plasma: { temperaturaC: 50, tiempoMinimoMin: 28 },
};

export function vencimientoDesde(liberadoEn: string, dias = DIAS_DE_VIGENCIA): string {
  const fecha = new Date(liberadoEn);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString();
}

export type ResultadoControl = 'pendiente' | 'conforme' | 'no_conforme';

/** Un ciclo se libera solo si los tres controles dieron conforme. */
export function sePuedeLiberar(controles: {
  fisico: ResultadoControl;
  quimico: ResultadoControl;
  biologico: ResultadoControl;
}): boolean {
  return (
    controles.fisico === 'conforme' &&
    controles.quimico === 'conforme' &&
    controles.biologico === 'conforme'
  );
}
