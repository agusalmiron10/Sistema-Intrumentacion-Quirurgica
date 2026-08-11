/**
 * Reemplaza los placeholders __PIN_xxxx__ del seed por hashes PBKDF2 reales.
 * Idempotente: si ya no hay placeholders, no hace nada.
 *
 *   node --experimental-strip-types scripts/generar-pins.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hashPin } from '../src/auth/pin.ts';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaSeed = join(raiz, 'seed', 'seed.sql');

let seed = await readFile(rutaSeed, 'utf8');
const placeholders = [...new Set(seed.match(/__PIN_(\d{4,6})__/g) ?? [])];

if (placeholders.length === 0) {
  console.log('Sin placeholders de PIN: nada que hacer.');
} else {
  for (const placeholder of placeholders) {
    const pin = placeholder.slice('__PIN_'.length, -'__'.length);
    seed = seed.replaceAll(placeholder, await hashPin(pin));
    console.log(`PIN ${pin} -> hash generado`);
  }
  await writeFile(rutaSeed, seed, 'utf8');
  console.log(`Actualizado ${rutaSeed}`);
}
