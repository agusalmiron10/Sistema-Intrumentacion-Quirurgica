import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { hashPin } from '../src/auth/pin';
import { firmarSesion, verificarSesion } from '../src/auth/sesion';

const BASE = 'https://test.local';
const PIN = '4821';

async function postJson(ruta: string, cuerpo: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

async function crearUsuario(id: string, nombre: string): Promise<void> {
  await env.DB.prepare(
    `insert or replace into usuario (id, nombre, email, pin_hash, rol, intentos_fallidos, bloqueado_hasta)
     values (?, ?, ?, ?, 'instrumentadora', 0, null)`,
  )
    .bind(id, nombre, `${id}@hospital.local`, await hashPin(PIN))
    .run();
}

beforeAll(async () => {
  await crearUsuario('s-ok', 'Usuaria correcta');
  await crearUsuario('s-bloqueo', 'Usuaria a bloquear');
});

describe('lista de usuarios para ingresar', () => {
  it('no expone el email ni el hash del PIN', async () => {
    const res = await SELF.fetch(`${BASE}/api/usuarios`);
    expect(res.status).toBe(200);

    const usuarios = await res.json<Record<string, unknown>[]>();
    expect(usuarios.length).toBeGreaterThan(0);
    for (const usuario of usuarios) {
      expect(Object.keys(usuario).sort()).toEqual(['id', 'nombre', 'rol']);
    }
  });
});

describe('ingreso por PIN', () => {
  it('devuelve un token con el PIN correcto', async () => {
    const res = await postJson('/api/sesion', { usuarioId: 's-ok', pin: PIN });
    expect(res.status).toBe(200);

    const cuerpo = await res.json<{ token: string; usuario: { id: string; rol: string } }>();
    expect(cuerpo.usuario.id).toBe('s-ok');
    expect(cuerpo.token.split('.')).toHaveLength(2);
  });

  it('el token sirve para consultar la sesion', async () => {
    const { token } = await (
      await postJson('/api/sesion', { usuarioId: 's-ok', pin: PIN })
    ).json<{ token: string }>();

    const res = await SELF.fetch(`${BASE}/api/sesion`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json<{ usuarioId: string }>()).usuarioId).toBe('s-ok');
  });

  it('rechaza el PIN equivocado y avisa cuantos intentos quedan', async () => {
    const res = await postJson('/api/sesion', { usuarioId: 's-ok', pin: '0000' });
    expect(res.status).toBe(401);

    const cuerpo = await res.json<{ error: string; intentosRestantes: number }>();
    expect(cuerpo.error).toBe('credenciales');
    expect(cuerpo.intentosRestantes).toBe(4);
  });

  it('rechaza un PIN con formato invalido antes de tocar la base', async () => {
    for (const pin of ['123', 'abcd', '12345678', '']) {
      const res = await postJson('/api/sesion', { usuarioId: 's-ok', pin });
      expect(res.status).toBe(400);
    }
  });

  it('un usuario inexistente responde igual que un PIN equivocado', async () => {
    const res = await postJson('/api/sesion', { usuarioId: 'no-existe', pin: PIN });
    expect(res.status).toBe(401);
    expect((await res.json<{ error: string }>()).error).toBe('credenciales');
  });
});

describe('bloqueo por intentos fallidos', () => {
  it('bloquea despues de cinco intentos y no cede ni con el PIN correcto', async () => {
    // Es lo unico que hace aceptable un PIN de cuatro digitos: sin bloqueo,
    // probar las 10.000 combinaciones es cuestion de minutos.
    for (let intento = 0; intento < 4; intento++) {
      const res = await postJson('/api/sesion', { usuarioId: 's-bloqueo', pin: '0000' });
      expect(res.status).toBe(401);
    }

    const quinto = await postJson('/api/sesion', { usuarioId: 's-bloqueo', pin: '0000' });
    expect(quinto.status).toBe(429);
    expect((await quinto.json<{ error: string }>()).error).toBe('bloqueado');

    const conElCorrecto = await postJson('/api/sesion', { usuarioId: 's-bloqueo', pin: PIN });
    expect(conElCorrecto.status).toBe(429);
  });

  it('un ingreso exitoso limpia los intentos acumulados', async () => {
    await crearUsuario('s-limpia', 'Usuaria que se recupera');
    await postJson('/api/sesion', { usuarioId: 's-limpia', pin: '0000' });
    await postJson('/api/sesion', { usuarioId: 's-limpia', pin: PIN });

    const fila = await env.DB.prepare('select intentos_fallidos from usuario where id = ?')
      .bind('s-limpia')
      .first<{ intentos_fallidos: number }>();
    expect(fila?.intentos_fallidos).toBe(0);
  });
});

describe('validacion del token', () => {
  const SECRETO = 'secreto-de-prueba';

  it('acepta el token que acaba de firmar', async () => {
    const token = await firmarSesion(SECRETO, 'u-1', 'instrumentadora');
    expect((await verificarSesion(SECRETO, token))?.usuarioId).toBe('u-1');
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await firmarSesion('otro-secreto', 'u-1', 'instrumentadora');
    expect(await verificarSesion(SECRETO, token)).toBeNull();
  });

  it('rechaza un token con la carga manipulada', async () => {
    const token = await firmarSesion(SECRETO, 'u-1', 'instrumentadora');
    const [, firma] = token.split('.');
    const cargaFalsa = btoa(JSON.stringify({ usuarioId: 'admin', rol: 'admin', exp: 9e9 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verificarSesion(SECRETO, `${cargaFalsa}.${firma}`)).toBeNull();
  });

  it('rechaza un token vencido', async () => {
    // Firmado hace 40 horas: la vida util es de 14, un turno largo.
    const token = await firmarSesion(
      SECRETO,
      'u-1',
      'instrumentadora',
      Date.now() - 40 * 60 * 60 * 1000,
    );
    expect(await verificarSesion(SECRETO, token)).toBeNull();
  });

  it('rechaza basura', async () => {
    for (const basura of ['', 'a', 'a.b.c', 'sin-punto']) {
      expect(await verificarSesion(SECRETO, basura)).toBeNull();
    }
  });
});

describe('rutas protegidas', () => {
  it('sin token responde 401', async () => {
    const res = await postJson('/api/eventos', { eventos: [] });
    expect(res.status).toBe(401);
  });

  it('con un token invalido responde 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/eventos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer no-sirve' },
      body: JSON.stringify({ eventos: [] }),
    });
    expect(res.status).toBe(401);
  });
});
