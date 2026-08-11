/**
 * Genera el hash de un PIN para dar de alta usuarios reales, sin usar el seed
 * de desarrollo.
 *
 *   node --experimental-strip-types scripts/hash-pin.ts 4821
 *
 * Imprime el INSERT listo para pegar. El PIN no se guarda en ningun lado: lo
 * unico que viaja a la base es el hash.
 */
import { hashPin, PIN_REGEX } from '../src/auth/pin.ts';

const pin = process.argv[2];

if (!pin || !PIN_REGEX.test(pin)) {
  console.error('Uso: node --experimental-strip-types scripts/hash-pin.ts <pin de 4 a 6 digitos>');
  process.exit(1);
}

const hash = await hashPin(pin);

console.log('\nHash generado:\n');
console.log(hash);
console.log('\nINSERT de ejemplo (cambiar nombre, email y rol):\n');
console.log(
  `INSERT INTO usuario (id, nombre, email, pin_hash, rol) VALUES\n` +
    `  ('${crypto.randomUUID()}', 'Nombre Apellido', 'usuario@hospital.local', '${hash}', 'instrumentadora');\n`,
);
console.log('Roles: instrumentadora | esterilizacion | supervisor | admin\n');
