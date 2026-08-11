import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api } from './ayudas-api';

/**
 * La configuracion inicial es el unico endpoint que escribe sin sesion.
 * Si dejara de cerrarse despues del primer uso, cualquiera podria crearse un
 * administrador. Es la superficie mas sensible del sistema.
 */

let tokenAdmin = '';

beforeAll(async () => {
  // Este archivo necesita arrancar con la base sin usuarios para poder probar
  // el camino de configuracion inicial.
  await env.DB.prepare('delete from usuario').run();
});

describe('configuracion inicial', () => {
  it('avisa que hace falta configurar cuando no hay usuarios', async () => {
    const res = await api<{ requiereConfiguracion: boolean }>('/api/setup');
    expect(res.estado).toBe(200);
    expect(res.cuerpo.requiereConfiguracion).toBe(true);
  });

  it('crea el primer administrador y devuelve la sesion iniciada', async () => {
    const res = await api<{ token: string; usuario: { rol: string; nombre: string } }>(
      '/api/setup',
      {
        metodo: 'POST',
        cuerpo: { nombre: 'Ximena Admin', email: 'ximena@hospital.local', pin: '4821' },
      },
    );

    expect(res.estado).toBe(201);
    expect(res.cuerpo.usuario.rol).toBe('admin');
    // Se devuelve la sesion ya iniciada: pedir el PIN recien elegido seria
    // un paso al pedo.
    expect(res.cuerpo.token.split('.')).toHaveLength(2);
    tokenAdmin = res.cuerpo.token;
  });

  it('el administrador creado puede entrar con su PIN', async () => {
    const usuarios = await api<{ id: string }[]>('/api/usuarios');
    const res = await api<{ usuario: { rol: string } }>('/api/sesion', {
      metodo: 'POST',
      cuerpo: { usuarioId: usuarios.cuerpo[0]?.id, pin: '4821' },
    });
    expect(res.estado).toBe(200);
    expect(res.cuerpo.usuario.rol).toBe('admin');
  });

  it('NO se puede usar dos veces', async () => {
    const res = await api<{ error: string }>('/api/setup', {
      metodo: 'POST',
      cuerpo: { nombre: 'Intruso', email: 'intruso@hospital.local', pin: '9999' },
    });

    expect(res.estado).toBe(409);
    expect(res.cuerpo.error).toBe('ya_configurado');
  });

  it('deja de pedir configuracion una vez hecha', async () => {
    const res = await api<{ requiereConfiguracion: boolean }>('/api/setup');
    expect(res.cuerpo.requiereConfiguracion).toBe(false);
  });

  it('valida el PIN antes de crear nada', async () => {
    for (const pin of ['12', 'abcd', '']) {
      const res = await api('/api/setup', {
        metodo: 'POST',
        cuerpo: { nombre: 'X', email: 'x@hospital.local', pin },
      });
      expect(res.estado).toBe(400);
    }
  });
});

describe('administracion de usuarios', () => {
  let idInstrumentadora = '';

  it('un administrador da de alta al resto del equipo', async () => {
    const res = await api<{ id: string; rol: string; activo: number }>('/api/admin/usuarios', {
      metodo: 'POST',
      token: tokenAdmin,
      cuerpo: {
        nombre: 'Marcela Duarte',
        email: 'marcela@hospital.local',
        rol: 'instrumentadora',
        pin: '1357',
      },
    });

    expect(res.estado).toBe(201);
    expect(res.cuerpo.rol).toBe('instrumentadora');
    idInstrumentadora = res.cuerpo.id;
  });

  it('el usuario dado de alta puede entrar', async () => {
    const res = await api<{ usuario: { rol: string } }>('/api/sesion', {
      metodo: 'POST',
      cuerpo: { usuarioId: idInstrumentadora, pin: '1357' },
    });
    expect(res.estado).toBe(200);
    expect(res.cuerpo.usuario.rol).toBe('instrumentadora');
  });

  it('la lista de administracion nunca expone el hash del PIN', async () => {
    const res = await api<Record<string, unknown>[]>('/api/admin/usuarios', { token: tokenAdmin });
    expect(res.estado).toBe(200);
    for (const usuario of res.cuerpo) {
      expect(Object.keys(usuario)).not.toContain('pinHash');
      expect(Object.keys(usuario)).not.toContain('pin_hash');
    }
  });

  it('quien no es admin no puede administrar usuarios', async () => {
    const sesion = await api<{ token: string }>('/api/sesion', {
      metodo: 'POST',
      cuerpo: { usuarioId: idInstrumentadora, pin: '1357' },
    });

    const listar = await api('/api/admin/usuarios', { token: sesion.cuerpo.token });
    expect(listar.estado).toBe(403);

    const crear = await api('/api/admin/usuarios', {
      metodo: 'POST',
      token: sesion.cuerpo.token,
      cuerpo: { nombre: 'X', email: 'x2@hospital.local', rol: 'admin', pin: '1111' },
    });
    expect(crear.estado).toBe(403);
  });

  it('sin sesion no se puede ni listar', async () => {
    expect((await api('/api/admin/usuarios')).estado).toBe(401);
  });

  it('cambiar el PIN destraba a alguien bloqueado por intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) {
      await api('/api/sesion', {
        metodo: 'POST',
        cuerpo: { usuarioId: idInstrumentadora, pin: '0000' },
      });
    }
    const bloqueada = await api('/api/sesion', {
      metodo: 'POST',
      cuerpo: { usuarioId: idInstrumentadora, pin: '1357' },
    });
    expect(bloqueada.estado).toBe(429);

    await api(`/api/admin/usuarios/${idInstrumentadora}`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      cuerpo: { pin: '2468' },
    });

    const despues = await api('/api/sesion', {
      metodo: 'POST',
      cuerpo: { usuarioId: idInstrumentadora, pin: '2468' },
    });
    expect(despues.estado).toBe(200);
  });

  it('dar de baja saca al usuario de la pantalla de ingreso', async () => {
    await api(`/api/admin/usuarios/${idInstrumentadora}`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      cuerpo: { activo: false },
    });

    const lista = await api<{ id: string }[]>('/api/usuarios');
    expect(lista.cuerpo.map((u) => u.id)).not.toContain(idInstrumentadora);

    const intento = await api('/api/sesion', {
      metodo: 'POST',
      cuerpo: { usuarioId: idInstrumentadora, pin: '2468' },
    });
    expect(intento.estado).toBe(401);
  });

  it('el ultimo administrador no se puede desactivar a si mismo', async () => {
    // Si pudiera, el sistema quedaria sin nadie que lo administre y la unica
    // salida seria tocar la base a mano.
    const yo = await api<{ usuarioId: string }>('/api/sesion', { token: tokenAdmin });

    const res = await api<{ error: string }>(`/api/admin/usuarios/${yo.cuerpo.usuarioId}`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      cuerpo: { activo: false },
    });

    expect(res.estado).toBe(422);
    expect(res.cuerpo.error).toBe('ultimo_admin');
  });

  it('tampoco se puede sacar el rol de admin siendo el unico', async () => {
    const yo = await api<{ usuarioId: string }>('/api/sesion', { token: tokenAdmin });

    const res = await api<{ error: string }>(`/api/admin/usuarios/${yo.cuerpo.usuarioId}`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      cuerpo: { rol: 'instrumentadora' },
    });
    expect(res.estado).toBe(422);
  });

  it('con otro admin activo si se puede', async () => {
    await api('/api/admin/usuarios', {
      metodo: 'POST',
      token: tokenAdmin,
      cuerpo: {
        nombre: 'Segundo Admin',
        email: 'segundo@hospital.local',
        rol: 'admin',
        pin: '5678',
      },
    });

    const yo = await api<{ usuarioId: string }>('/api/sesion', { token: tokenAdmin });
    const res = await api(`/api/admin/usuarios/${yo.cuerpo.usuarioId}`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      cuerpo: { rol: 'supervisor' },
    });
    expect(res.estado).toBe(200);
  });

  it('rechaza un email repetido', async () => {
    const res = await api('/api/admin/usuarios', {
      metodo: 'POST',
      token: tokenAdmin,
      cuerpo: {
        nombre: 'Otro',
        email: 'segundo@hospital.local',
        rol: 'instrumentadora',
        pin: '1111',
      },
    });
    expect(res.estado).toBe(409);
  });
});
