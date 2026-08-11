import QRCode from 'qrcode';

/**
 * Generacion del QR a nivel matriz.
 *
 * Trabajamos con la matriz de modulos y no con un PNG porque las etiquetas se
 * dibujan como vectores en el PDF: quedan nitidas a cualquier tamanio, pesan
 * mucho menos y no dependen de un canvas (que en Workers no existe).
 */

/** Nivel H: tolera hasta 30% de dano. Las cajas se rayan y se ensucian. */
const CORRECCION = 'H' as const;

/** Zona de silencio obligatoria alrededor del codigo, en modulos. */
export const ZONA_SILENCIO = 4;

export interface MatrizQr {
  /** Lado en modulos, sin contar la zona de silencio. */
  tamanio: number;
  /** true = modulo oscuro. Indexado [fila * tamanio + columna]. */
  oscuro: (fila: number, columna: number) => boolean;
  version: number;
}

export function matrizQr(texto: string): MatrizQr {
  const qr = QRCode.create(texto, { errorCorrectionLevel: CORRECCION });
  const { size, data } = qr.modules;
  return {
    tamanio: size,
    version: qr.version,
    oscuro: (fila, columna) => ((data[fila * size + columna] ?? 0) & 1) === 1,
  };
}

export interface Franja {
  fila: number;
  columna: number;
  largo: number;
}

/**
 * Junta los modulos oscuros contiguos de cada fila en una sola franja.
 *
 * Sin esto, una etiqueta de version 6 son ~840 rectangulos y una hoja de 16
 * etiquetas pasa de 13.000. Con el agrupado baja alrededor de un tercio, y el
 * PDF resultante es proporcionalmente mas chico.
 */
export function franjasHorizontales(matriz: MatrizQr): Franja[] {
  const franjas: Franja[] = [];
  for (let fila = 0; fila < matriz.tamanio; fila++) {
    let inicio = -1;
    for (let columna = 0; columna <= matriz.tamanio; columna++) {
      const oscuro = columna < matriz.tamanio && matriz.oscuro(fila, columna);
      if (oscuro && inicio === -1) {
        inicio = columna;
      } else if (!oscuro && inicio !== -1) {
        franjas.push({ fila, columna: inicio, largo: columna - inicio });
        inicio = -1;
      }
    }
  }
  return franjas;
}

/** SVG autocontenido, para mostrar el QR de una caja en pantalla. */
export function qrSvg(texto: string, ladoPx = 256): string {
  const matriz = matrizQr(texto);
  const total = matriz.tamanio + ZONA_SILENCIO * 2;
  const rects = franjasHorizontales(matriz)
    .map(
      (f) =>
        `<rect x="${f.columna + ZONA_SILENCIO}" y="${f.fila + ZONA_SILENCIO}" width="${f.largo}" height="1"/>`,
    )
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ladoPx}" height="${ladoPx}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Codigo QR de la caja">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<g fill="#000">${rects}</g>` +
    `</svg>`
  );
}
