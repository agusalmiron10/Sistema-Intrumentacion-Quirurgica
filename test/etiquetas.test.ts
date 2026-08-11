import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { urlDeCaja } from '../src/dominio/identificadores';
import { calcularGeometria, generarPliego } from '../src/servicios/etiquetas';
import { franjasHorizontales, matrizQr, qrSvg, ZONA_SILENCIO } from '../src/servicios/qr';
import { sembrarBase } from './ayudas';

const BASE = 'https://test.local';

async function postJson(ruta: string, cuerpo: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

beforeAll(async () => {
  await sembrarBase();
  for (const codigo of ['ETI-01', 'ETI-02', 'ETI-03']) {
    await postJson('/api/cajas', { codigo, nombre: `Caja ${codigo}`, servicio: 'Cirugia general' });
  }
});

describe('matriz del QR', () => {
  it('usa correccion de errores H', async () => {
    // Nivel H = tolera 30% de dano. Con el mismo contenido, un nivel mas bajo
    // daria una matriz mas chica: si esta prueba baja de tamanio, alguien
    // cambio el nivel.
    const matriz = matrizQr(urlDeCaja(BASE, 'K7Q2M9XB4T'));
    expect(matriz.tamanio).toBe(matriz.version * 4 + 17);
    expect(matriz.tamanio).toBeGreaterThanOrEqual(33);
  });

  it('las franjas reconstruyen exactamente la matriz original', async () => {
    // El agrupado de modulos contiguos es lo que mantiene chico el PDF; si
    // pierde o agrega un modulo, el QR deja de leerse.
    const matriz = matrizQr(urlDeCaja(BASE, 'ABCDEFGHJK'));
    const reconstruida = new Set<string>();
    for (const franja of franjasHorizontales(matriz)) {
      for (let i = 0; i < franja.largo; i++) {
        reconstruida.add(`${franja.fila},${franja.columna + i}`);
      }
    }

    const original = new Set<string>();
    for (let fila = 0; fila < matriz.tamanio; fila++) {
      for (let columna = 0; columna < matriz.tamanio; columna++) {
        if (matriz.oscuro(fila, columna)) original.add(`${fila},${columna}`);
      }
    }

    expect(reconstruida).toEqual(original);
  });

  it('agrupar achica de verdad la cantidad de rectangulos', async () => {
    const matriz = matrizQr(urlDeCaja(BASE, 'ABCDEFGHJK'));
    let oscuros = 0;
    for (let fila = 0; fila < matriz.tamanio; fila++) {
      for (let columna = 0; columna < matriz.tamanio; columna++) {
        if (matriz.oscuro(fila, columna)) oscuros++;
      }
    }
    expect(franjasHorizontales(matriz).length).toBeLessThan(oscuros * 0.8);
  });

  it('el SVG incluye la zona de silencio', async () => {
    const matriz = matrizQr(urlDeCaja(BASE, 'ABCDEFGHJK'));
    const svg = qrSvg(urlDeCaja(BASE, 'ABCDEFGHJK'));
    const lado = matriz.tamanio + ZONA_SILENCIO * 2;

    expect(svg).toContain(`viewBox="0 0 ${lado} ${lado}"`);
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe('geometria del pliego', () => {
  it('entran 16 etiquetas por hoja A4 con QR de 25mm', async () => {
    const geo = calcularGeometria(25);
    expect(geo.columnas).toBe(2);
    expect(geo.filas).toBe(8);
    expect(geo.porPagina).toBe(16);
  });

  it('con QR mas grande entran menos, nunca cero', async () => {
    const geo = calcularGeometria(60);
    expect(geo.porPagina).toBeGreaterThanOrEqual(1);
    expect(geo.porPagina).toBeLessThan(16);
  });

  it('la etiqueta nunca queda por debajo del minimo de 2cm', async () => {
    // 20mm es el piso del pliego de requisitos.
    const geo = calcularGeometria(20);
    expect(geo.ladoQr).toBeGreaterThanOrEqual((20 * 72) / 25.4);
  });
});

describe('generacion del PDF', () => {
  it('genera un PDF valido', async () => {
    const pdf = await generarPliego(
      [{ id: 'K7Q2M9XB4T', codigo: 'LAP-02', nombre: 'Caja laparoscopia 2', servicio: 'Cirugia' }],
      { dominio: BASE, ladoQrMm: 25, incluirBorde: true },
    );

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('no explota con acentos ni con caracteres fuera de latin-1', async () => {
    // Las fuentes estandar de PDF son WinAnsi: un caracter raro pegado desde
    // otro sistema no puede tirar abajo la generacion de todo el pliego.
    const pdf = await generarPliego(
      [
        { id: 'K7Q2M9XB4T', codigo: 'GEN-01', nombre: 'Caja cirugía general ñandú', servicio: 'Obstetricia' },
        { id: 'ABCDEFGHJK', codigo: 'GEN-02', nombre: 'Caja 🧪 con emoji', servicio: null },
      ],
      { dominio: BASE, ladoQrMm: 25, incluirBorde: false },
    );
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });

  it('se queja si no hay nada que imprimir', async () => {
    await expect(
      generarPliego([], { dominio: BASE, ladoQrMm: 25, incluirBorde: true }),
    ).rejects.toThrow(/No hay cajas/);
  });
});

describe('endpoint de etiquetas', () => {
  it('devuelve el PDF con la cantidad en las cabeceras', async () => {
    const res = await postJson('/api/etiquetas', { refs: ['ETI-01', 'ETI-02'] });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-etiquetas-total')).toBe('2');
    expect(res.headers.get('content-disposition')).toContain('etiquetas-cajas.pdf');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('acepta ids y codigos mezclados', async () => {
    const caja = await (
      await SELF.fetch(`${BASE}/api/cajas/ETI-03`)
    ).json<{ id: string }>();

    const res = await postJson('/api/etiquetas', { refs: ['ETI-01', caja.id] });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-etiquetas-total')).toBe('2');
  });

  it('no imprime un pliego incompleto: falla y dice cuales faltan', async () => {
    // Imprimir 200 etiquetas y descubrir despues que faltan tres es
    // exactamente el error que hay que evitar.
    const res = await postJson('/api/etiquetas', { refs: ['ETI-01', 'NO-EXISTE', 'TAMPOCO'] });

    expect(res.status).toBe(422);
    const cuerpo = await res.json<{ error: string; faltantes: string[] }>();
    expect(cuerpo.error).toBe('refs_inexistentes');
    expect(cuerpo.faltantes).toEqual(['NO-EXISTE', 'TAMPOCO']);
  });

  it('rechaza un QR por debajo del minimo de 2cm', async () => {
    const res = await postJson('/api/etiquetas', { refs: ['ETI-01'], ladoQrMm: 12 });
    expect(res.status).toBe(400);
  });

  it('rechaza una lista vacia', async () => {
    const res = await postJson('/api/etiquetas', { refs: [] });
    expect(res.status).toBe(400);
  });
});
