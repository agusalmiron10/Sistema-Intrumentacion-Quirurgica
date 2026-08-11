import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { hashPin } from '../src/auth/pin';

const BASE = 'https://test.local';
const PIN = '7391';

let token = '';
let tokenOtro = '';

interface Resultado {
  id: string;
  cajaRef: string;
  estado: 'aplicado' | 'duplicado' | 'conflicto';
  codigo?: string;
  estadoActual?: string;
}

async function crearUsuario(id: string): Promise<void> {
  await env.DB.prepare(
    `insert or replace into usuario (id, nombre, email, pin_hash, rol, intentos_fallidos, bloqueado_hasta)
     values (?, ?, ?, ?, 'esterilizacion', 0, null)`,
  )
    .bind(id, `Usuaria ${id}`, `${id}@hospital.local`, await hashPin(PIN))
    .run();
}

async function ingresar(usuarioId: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/sesion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuarioId, pin: PIN }),
  });
  return (await res.json<{ token: string }>()).token;
}

async function crearCaja(codigo: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/cajas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo, nombre: `Caja ${codigo}` }),
  });
  return (await res.json<{ id: string }>()).id;
}

async function enviar(
  eventos: unknown[],
  conToken = token,
): Promise<{ estado: number; resultados: Resultado[] }> {
  const res = await SELF.fetch(`${BASE}/api/eventos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conToken}` },
    body: JSON.stringify({ eventos }),
  });
  if (res.status !== 200) return { estado: res.status, resultados: [] };
  return { estado: 200, resultados: (await res.json<{ resultados: Resultado[] }>()).resultados };
}

function evento(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    usuarioId: 'ev-1',
    ocurridoEn: new Date().toISOString(),
    ...extra,
  };
}

beforeAll(async () => {
  await crearUsuario('ev-1');
  await crearUsuario('ev-2');
  token = await ingresar('ev-1');
  tokenOtro = await ingresar('ev-2');
});

describe('sincronizacion de eventos', () => {
  it('aplica un escaneo y mueve la caja', async () => {
    await crearCaja('EV-01');

    const { resultados } = await enviar([
      evento({ cajaRef: 'EV-01', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' }),
    ]);

    expect(resultados[0]?.estado).toBe('aplicado');
    expect(resultados[0]?.estadoActual).toBe('en_lavado');
  });

  it('resuelve la caja tanto por codigo como por id', async () => {
    const id = await crearCaja('EV-02');

    const porCodigo = await enviar([
      evento({ cajaRef: 'ev-02', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' }),
    ]);
    expect(porCodigo.resultados[0]?.estado).toBe('aplicado');

    const porId = await enviar([
      evento({ cajaRef: id, estadoDesde: 'en_lavado', estadoHasta: 'en_armado' }),
    ]);
    expect(porId.resultados[0]?.estado).toBe('aplicado');
    expect(porId.resultados[0]?.estadoActual).toBe('en_armado');
  });

  it('aplica el lote en orden cronologico aunque llegue desordenado', async () => {
    // Es el caso tipico de la cola offline: dos escaneos encadenados que
    // fallarian si se aplicaran en el orden en que salieron de IndexedDB.
    await crearCaja('EV-03');

    const { resultados } = await enviar([
      evento({
        cajaRef: 'EV-03',
        estadoDesde: 'en_lavado',
        estadoHasta: 'en_armado',
        ocurridoEn: '2026-08-10T11:00:00.000Z',
      }),
      evento({
        cajaRef: 'EV-03',
        estadoDesde: 'esteril_deposito',
        estadoHasta: 'en_lavado',
        ocurridoEn: '2026-08-10T10:00:00.000Z',
      }),
    ]);

    expect(resultados.every((r) => r.estado === 'aplicado')).toBe(true);

    const caja = await SELF.fetch(`${BASE}/api/cajas/EV-03`);
    expect((await caja.json<{ estado: string }>()).estado).toBe('en_armado');
  });

  it('reenviar el mismo lote no duplica nada', async () => {
    await crearCaja('EV-04');
    const lote = [
      evento({ cajaRef: 'EV-04', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' }),
    ];

    const primera = await enviar(lote);
    expect(primera.resultados[0]?.estado).toBe('aplicado');

    // Reintento despues de que se corto la red antes del ACK.
    const segunda = await enviar(lote);
    expect(segunda.resultados[0]?.estado).toBe('duplicado');

    const fila = await env.DB.prepare(
      `select count(*) as n from movimiento_caja m
        join caja c on c.id = m.caja_id where c.codigo = 'EV-04'`,
    ).first<{ n: number }>();
    expect(fila?.n).toBe(1);
  });

  it('devuelve el conflicto en vez de descartarlo, con el estado real', async () => {
    await crearCaja('EV-05');
    await enviar([
      evento({ cajaRef: 'EV-05', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' }),
    ]);

    // Escaneo viejo que quedo en la cola: la caja ya se movio por otro lado.
    const { resultados } = await enviar([
      evento({ cajaRef: 'EV-05', estadoDesde: 'esteril_deposito', estadoHasta: 'asignada' }),
    ]);

    expect(resultados[0]?.estado).toBe('conflicto');
    expect(resultados[0]?.codigo).toBe('conflicto_estado');
    expect(resultados[0]?.estadoActual).toBe('en_lavado');
  });

  it('rechaza una transicion ilegal sin frenar el resto del lote', async () => {
    await crearCaja('EV-06');
    await crearCaja('EV-07');

    const { resultados } = await enviar([
      evento({
        cajaRef: 'EV-06',
        estadoDesde: 'esteril_deposito',
        estadoHasta: 'en_esterilizacion',
        ocurridoEn: '2026-08-10T10:00:00.000Z',
      }),
      evento({
        cajaRef: 'EV-07',
        estadoDesde: 'esteril_deposito',
        estadoHasta: 'en_lavado',
        ocurridoEn: '2026-08-10T10:01:00.000Z',
      }),
    ]);

    expect(resultados.find((r) => r.cajaRef === 'EV-06')?.codigo).toBe('transicion_invalida');
    expect(resultados.find((r) => r.cajaRef === 'EV-07')?.estado).toBe('aplicado');
  });

  it('avisa cuando la caja no existe', async () => {
    const { resultados } = await enviar([
      evento({ cajaRef: 'NO-EXISTE', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' }),
    ]);

    expect(resultados[0]?.estado).toBe('conflicto');
    expect(resultados[0]?.codigo).toBe('caja_inexistente');
  });
});

describe('quien escaneo', () => {
  it('no deja sincronizar escaneos de otro usuario', async () => {
    // La tablet cambio de mano con la cola sin vaciar. Esos escaneos tienen
    // que quedar a nombre de quien los hizo, no de quien esta logueado ahora.
    await crearCaja('EV-08');

    const { resultados } = await enviar(
      [evento({ cajaRef: 'EV-08', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' })],
      tokenOtro,
    );

    expect(resultados[0]?.estado).toBe('conflicto');
    expect(resultados[0]?.codigo).toBe('usuario_distinto');
  });

  it('el movimiento queda registrado a nombre de quien escaneo', async () => {
    await crearCaja('EV-09');
    await enviar([
      evento({ cajaRef: 'EV-09', estadoDesde: 'esteril_deposito', estadoHasta: 'en_lavado' }),
    ]);

    const fila = await env.DB.prepare(
      `select m.usuario_id from movimiento_caja m
        join caja c on c.id = m.caja_id where c.codigo = 'EV-09'`,
    ).first<{ usuario_id: string }>();
    expect(fila?.usuario_id).toBe('ev-1');
  });
});

describe('relojes desfasados', () => {
  it('rechaza un escaneo con fecha futura', async () => {
    // Una tablet con la fecha mal puesta romperia el orden de aplicacion y
    // podria colar una caja vencida como vigente, porque el control de
    // vencimiento se compara justamente contra ocurrido_en.
    await crearCaja('EV-10');
    const dentroDeUnaSemana = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { resultados } = await enviar([
      evento({
        cajaRef: 'EV-10',
        estadoDesde: 'esteril_deposito',
        estadoHasta: 'en_lavado',
        ocurridoEn: dentroDeUnaSemana,
      }),
    ]);

    expect(resultados[0]?.codigo).toBe('reloj_desfasado');
  });

  it('acepta un escaneo de hace horas, que es lo normal al sincronizar tarde', async () => {
    await crearCaja('EV-11');
    const hace8Horas = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

    const { resultados } = await enviar([
      evento({
        cajaRef: 'EV-11',
        estadoDesde: 'esteril_deposito',
        estadoHasta: 'en_lavado',
        ocurridoEn: hace8Horas,
      }),
    ]);

    expect(resultados[0]?.estado).toBe('aplicado');
  });
});

describe('validacion del lote', () => {
  it('rechaza un lote vacio', async () => {
    expect((await enviar([])).estado).toBe(400);
  });

  it('rechaza un id de evento que no sea UUID', async () => {
    const res = await enviar([
      { id: 'no-es-uuid', usuarioId: 'ev-1', cajaRef: 'EV-01', estadoDesde: 'en_lavado', estadoHasta: 'en_armado', ocurridoEn: new Date().toISOString() },
    ]);
    expect(res.estado).toBe(400);
  });

  it('rechaza un estado que no existe', async () => {
    const res = await enviar([
      evento({ cajaRef: 'EV-01', estadoDesde: 'en_lavado', estadoHasta: 'inventado' }),
    ]);
    expect(res.estado).toBe(400);
  });
});
