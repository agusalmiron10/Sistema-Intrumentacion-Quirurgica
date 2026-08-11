import { describe, expect, it } from 'vitest';

/**
 * exceljs esta pensado para Node y arrastra streams, zlib y unos cuantos
 * polyfills. Antes de construir los reportes encima hay que saber si corre
 * dentro de workerd: si no corre, no sirve de nada que los tests de la logica
 * pasen.
 */
describe('exceljs dentro de workerd', () => {
  it('genera un xlsx real', async () => {
    const ExcelJS = await import('exceljs');
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Prueba');
    hoja.columns = [
      { header: 'Codigo', key: 'codigo', width: 12 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
    ];
    hoja.addRow({ codigo: 'LAP-02', cantidad: 3 });

    const buffer = await libro.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);

    // Un xlsx es un ZIP: tiene que empezar con la firma PK.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
