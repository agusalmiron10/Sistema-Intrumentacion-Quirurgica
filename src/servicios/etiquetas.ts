import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { urlDeCaja } from '../dominio/identificadores';
import { franjasHorizontales, matrizQr, ZONA_SILENCIO } from './qr';

/**
 * Pliego de etiquetas en PDF.
 *
 * El QR se dibuja como rectangulos vectoriales, no como imagen: sale nitido a
 * cualquier resolucion de impresora, el archivo pesa poco y no hace falta un
 * canvas (que en Workers no existe).
 *
 * En la etiqueta va solo lo que no cambia: codigo legible, nombre y servicio.
 * Nada de estado ni vencimiento, porque entonces habria que reimprimir.
 */

export interface CajaEtiqueta {
  id: string;
  codigo: string;
  nombre: string;
  servicio: string | null;
}

export interface OpcionesPliego {
  dominio: string;
  ladoQrMm: number;
  incluirBorde: boolean;
}

const MM = 72 / 25.4;
const mm = (valor: number): number => valor * MM;

// A4 vertical
const ANCHO_PAGINA = mm(210);
const ALTO_PAGINA = mm(297);

const MARGEN = mm(10);
const PADDING = mm(3);
const SEPARACION_QR_TEXTO = mm(4);
const ANCHO_TEXTO = mm(52);
const GAP_COLUMNA = mm(6);
const GAP_FILA = mm(3);

const GRIS = rgb(0.45, 0.45, 0.45);
const GRIS_BORDE = rgb(0.8, 0.8, 0.8);
const NEGRO = rgb(0, 0, 0);

/**
 * Las fuentes estandar de PDF usan WinAnsi, que cubre todo el latin-1 (o sea,
 * los acentos y la enie). Lo que quede afuera se reemplaza en vez de hacer
 * explotar la generacion entera por un caracter raro pegado desde otro sistema.
 */
function soloWinAnsi(texto: string): string {
  return [...texto]
    .map((caracter) => {
      const punto = caracter.codePointAt(0) ?? 0;
      if (punto > 0xff) return '?'; // fuera de latin-1
      if (punto < 0x20 || (punto >= 0x7f && punto <= 0x9f)) return ' '; // de control
      return caracter;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncar(texto: string, fuente: PDFFont, tamanio: number, anchoMax: number): string {
  const limpio = soloWinAnsi(texto);
  if (fuente.widthOfTextAtSize(limpio, tamanio) <= anchoMax) return limpio;

  let recortado = limpio;
  while (recortado.length > 1 && fuente.widthOfTextAtSize(`${recortado}...`, tamanio) > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return `${recortado}...`;
}

interface Geometria {
  ladoQr: number;
  ancho: number;
  alto: number;
  columnas: number;
  filas: number;
  porPagina: number;
}

export function calcularGeometria(ladoQrMm: number): Geometria {
  const ladoQr = mm(ladoQrMm);
  const ancho = PADDING + ladoQr + SEPARACION_QR_TEXTO + ANCHO_TEXTO + PADDING;
  const alto = ladoQr + PADDING * 2;

  const utilAncho = ANCHO_PAGINA - MARGEN * 2;
  const utilAlto = ALTO_PAGINA - MARGEN * 2;

  const columnas = Math.max(1, Math.floor((utilAncho + GAP_COLUMNA) / (ancho + GAP_COLUMNA)));
  const filas = Math.max(1, Math.floor((utilAlto + GAP_FILA) / (alto + GAP_FILA)));

  return { ladoQr, ancho, alto, columnas, filas, porPagina: columnas * filas };
}

/** Dibuja el QR ocupando un cuadrado, incluida la zona de silencio. */
function dibujarQr(pagina: PDFPage, texto: string, x: number, y: number, lado: number): void {
  const matriz = matrizQr(texto);
  const total = matriz.tamanio + ZONA_SILENCIO * 2;
  const modulo = lado / total;

  // Fondo blanco: la zona de silencio tiene que existir aunque se imprima
  // sobre papel de color.
  pagina.drawRectangle({ x, y, width: lado, height: lado, color: rgb(1, 1, 1) });

  for (const franja of franjasHorizontales(matriz)) {
    pagina.drawRectangle({
      x: x + (franja.columna + ZONA_SILENCIO) * modulo,
      // El PDF tiene el origen abajo a la izquierda y la matriz arriba: se invierte la fila.
      y: y + lado - (franja.fila + ZONA_SILENCIO + 1) * modulo,
      width: franja.largo * modulo,
      height: modulo,
      color: NEGRO,
    });
  }
}

function dibujarEtiqueta(
  pagina: PDFPage,
  caja: CajaEtiqueta,
  x: number,
  y: number,
  geo: Geometria,
  opciones: OpcionesPliego,
  fuentes: { normal: PDFFont; negrita: PDFFont },
): void {
  if (opciones.incluirBorde) {
    pagina.drawRectangle({
      x,
      y,
      width: geo.ancho,
      height: geo.alto,
      borderColor: GRIS_BORDE,
      borderWidth: 0.5,
    });
  }

  dibujarQr(pagina, urlDeCaja(opciones.dominio, caja.id), x + PADDING, y + PADDING, geo.ladoQr);

  const xTexto = x + PADDING + geo.ladoQr + SEPARACION_QR_TEXTO;
  const topeTexto = y + geo.alto - PADDING;

  // El codigo legible es lo mas grande de la etiqueta: es lo que se tipea a
  // mano cuando el QR ya no se deja leer.
  const tamanioCodigo = Math.min(20, Math.max(12, geo.ladoQr * 0.22));
  pagina.drawText(truncar(caja.codigo, fuentes.negrita, tamanioCodigo, ANCHO_TEXTO), {
    x: xTexto,
    y: topeTexto - tamanioCodigo,
    size: tamanioCodigo,
    font: fuentes.negrita,
    color: NEGRO,
  });

  const tamanioNombre = 9;
  pagina.drawText(truncar(caja.nombre, fuentes.normal, tamanioNombre, ANCHO_TEXTO), {
    x: xTexto,
    y: topeTexto - tamanioCodigo - mm(4) - tamanioNombre,
    size: tamanioNombre,
    font: fuentes.normal,
    color: NEGRO,
  });

  if (caja.servicio) {
    const tamanioServicio = 8;
    pagina.drawText(truncar(caja.servicio, fuentes.normal, tamanioServicio, ANCHO_TEXTO), {
      x: xTexto,
      y: topeTexto - tamanioCodigo - mm(4) - tamanioNombre - mm(3.5) - tamanioServicio,
      size: tamanioServicio,
      font: fuentes.normal,
      color: GRIS,
    });
  }
}

export async function generarPliego(
  cajas: readonly CajaEtiqueta[],
  opciones: OpcionesPliego,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Etiquetas de cajas de instrumental');
  pdf.setCreator('Sistema de instrumentacion quirurgica');

  const fuentes = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    negrita: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  if (cajas.length === 0) throw new Error('No hay cajas para etiquetar');

  const geo = calcularGeometria(opciones.ladoQrMm);

  for (let i = 0; i < cajas.length; i += geo.porPagina) {
    const pagina = pdf.addPage([ANCHO_PAGINA, ALTO_PAGINA]);
    const dePagina = cajas.slice(i, i + geo.porPagina);

    dePagina.forEach((caja, indice) => {
      const columna = indice % geo.columnas;
      const fila = Math.floor(indice / geo.columnas);
      const x = MARGEN + columna * (geo.ancho + GAP_COLUMNA);
      const y = ALTO_PAGINA - MARGEN - (fila + 1) * geo.alto - fila * GAP_FILA;
      dibujarEtiqueta(pagina, caja, x, y, geo, opciones, fuentes);
    });
  }

  return pdf.save();
}
