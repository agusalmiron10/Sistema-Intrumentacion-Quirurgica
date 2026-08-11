/**
 * Borra la base D1 local de desarrollo (.wrangler/state/v3/d1) para poder
 * volver a migrar y sembrar desde cero. No toca nada remoto.
 */
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaD1 = join(raiz, '.wrangler', 'state', 'v3', 'd1');

await rm(rutaD1, { recursive: true, force: true });
console.log(`Base local borrada: ${rutaD1}`);
