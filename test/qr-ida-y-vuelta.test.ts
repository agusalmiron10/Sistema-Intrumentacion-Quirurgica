import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { urlDeCaja } from '../src/dominio/identificadores';
import { franjasHorizontales, matrizQr, ZONA_SILENCIO } from '../src/servicios/qr';

/**
 * La prueba que mas importa de todo el modulo de QR: que el codigo generado se
 * decodifique de vuelta a la URL exacta.
 *
 * Se rasteriza a partir de las MISMAS franjas que dibuja el PDF, no de la
 * matriz cruda: asi el test cubre tambien el agrupado de modulos contiguos y
 * la inversion de filas. Si alguna de esas dos cosas se rompe, el QR impreso
 * deja de leerse y aca se ve.
 */

const ESCALA = 4; // pixeles por modulo

function rasterizar(texto: string): { datos: Uint8ClampedArray; lado: number } {
  const matriz = matrizQr(texto);
  const modulos = matriz.tamanio + ZONA_SILENCIO * 2;
  const lado = modulos * ESCALA;

  // Arranca todo blanco: la zona de silencio es simplemente el borde sin pintar.
  const datos = new Uint8ClampedArray(lado * lado * 4).fill(255);

  const pintar = (fila: number, columna: number, largo: number): void => {
    for (let y = 0; y < ESCALA; y++) {
      for (let x = 0; x < largo * ESCALA; x++) {
        const px = (columna + ZONA_SILENCIO) * ESCALA + x;
        const py = (fila + ZONA_SILENCIO) * ESCALA + y;
        const base = (py * lado + px) * 4;
        datos[base] = 0;
        datos[base + 1] = 0;
        datos[base + 2] = 0;
      }
    }
  };

  for (const franja of franjasHorizontales(matriz)) {
    pintar(franja.fila, franja.columna, franja.largo);
  }

  return { datos, lado };
}

function decodificar(texto: string): string | null {
  const { datos, lado } = rasterizar(texto);
  return jsQR(datos, lado, lado)?.data ?? null;
}

describe('el QR generado se lee de vuelta', () => {
  it('devuelve exactamente la URL de la caja', () => {
    const url = urlDeCaja('https://inst.hospital.ar', 'K7Q2M9XB4T');
    expect(decodificar(url)).toBe(url);
  });

  it('funciona tambien con un dominio largo y un id tipo UUID', () => {
    const url = urlDeCaja(
      'https://instrumentacion.hospital.local',
      '8f14e45f-ceea-467a-9c1e-0f4a1b2c3d4e',
    );
    expect(decodificar(url)).toBe(url);
  });

  it('ids distintos dan codigos distintos', () => {
    const a = urlDeCaja('https://inst.hospital.ar', 'K7Q2M9XB4T');
    const b = urlDeCaja('https://inst.hospital.ar', 'K7Q2M9XB4V');
    expect(decodificar(a)).toBe(a);
    expect(decodificar(b)).toBe(b);
    expect(decodificar(a)).not.toBe(decodificar(b));
  });

  it('sigue leyendose con modulos sueltos danados por toda la superficie', () => {
    // Este es el motivo de usar correccion H y no M: la etiqueta se raya, se
    // mancha y se despega de a poco.
    //
    // El dano se simula disperso y no como un bloque contiguo, porque asi se
    // gasta una etiqueta en la realidad, y porque el 30% que tolera el nivel H
    // es sobre los codewords de datos: un bloque solido que tape un patron de
    // deteccion o de alineacion no lo recupera ningun nivel de correccion,
    // esos patrones son estructurales.
    //
    // De ahi sale el 3% de modulos danados y no un numero mas alto: un codeword
    // son 8 modulos, asi que con una tasa p por modulo se corrompe 1-(1-p)^8 de
    // los codewords. Para no pasarse del 30% que recupera H, p tiene que quedar
    // por debajo de ~4,4%.
    const url = urlDeCaja('https://inst.hospital.ar', 'K7Q2M9XB4T');
    const matriz = matrizQr(url);
    const { datos, lado } = rasterizar(url);
    const modulos = matriz.tamanio + ZONA_SILENCIO * 2;

    // Generador deterministico: el test no puede fallar una de cada tantas veces.
    let semilla = 20260810;
    const siguiente = (): number => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla / 2147483648;
    };

    /** Las esquinas con los patrones de deteccion quedan intactas. */
    const esPatronDeteccion = (fila: number, columna: number): boolean => {
      const f = fila - ZONA_SILENCIO;
      const c = columna - ZONA_SILENCIO;
      const cerca = (a: number, b: number): boolean => a >= -1 && a <= 8 && b >= -1 && b <= 8;
      return (
        cerca(f, c) ||
        cerca(f, matriz.tamanio - 1 - c) ||
        cerca(matriz.tamanio - 1 - f, c)
      );
    };

    let danados = 0;
    for (let fila = ZONA_SILENCIO; fila < modulos - ZONA_SILENCIO; fila++) {
      for (let columna = ZONA_SILENCIO; columna < modulos - ZONA_SILENCIO; columna++) {
        if (esPatronDeteccion(fila, columna) || siguiente() > 0.03) continue;
        danados++;
        const valor = siguiente() > 0.5 ? 0 : 255;
        for (let y = 0; y < ESCALA; y++) {
          for (let x = 0; x < ESCALA; x++) {
            const base = ((fila * ESCALA + y) * lado + columna * ESCALA + x) * 4;
            datos[base] = valor;
            datos[base + 1] = valor;
            datos[base + 2] = valor;
          }
        }
      }
    }

    expect(danados).toBeGreaterThan(25);
    expect(jsQR(datos, lado, lado)?.data).toBe(url);
  });
});
