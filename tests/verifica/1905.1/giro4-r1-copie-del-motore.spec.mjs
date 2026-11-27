// Verifica #1905.1 giro 4: la copia del motore senza privilegi di una versione vecchia non resta nella cache per sempre.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const F = require('../../../scripts/lib/fusibili-electron.js');

// Un Electron finto: il filo dei fusibili con GrantFileProtocolExtraPrivileges acceso, come quello di fabbrica.
function motore(cartella, versione) {
  const dist = join(cartella, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(cartella, 'package.json'), JSON.stringify({ name: 'electron', version: versione }));
  writeFileSync(join(cartella, 'path.txt'), 'electron');
  writeFileSync(join(dist, 'version'), versione);
  writeFileSync(join(dist, 'electron'), Buffer.concat([Buffer.alloc(64, 7), F.SENTINELLA, Buffer.from([1, 10]), Buffer.alloc(10, 0x31), Buffer.alloc(64, 7)]));
  writeFileSync(join(dist, 'libnode.so'), Buffer.alloc(1024, 1));
}

test('r1 aggiornato Electron, la copia senza privilegi della versione di prima esce dalla cache', async () => {
  const base = cartellaTemporanea('motori-');
  const clone = join(base, 'altra-cartella', 'clone');
  const moduli = join(base, 'altra-cartella', 'node_modules', 'electron');
  const cache = join(base, 'cache');
  mkdirSync(clone, { recursive: true });
  motore(moduli, '44.10.2');
  const prima = F.motoreSenzaPrivilegi({ radice: clone, cache, piattaforma: 'linux' });
  expect(prima, 'la prima copia nasce').toMatchObject({ copia: true });
  // L'aggiornamento di Electron rimette nei moduli il motore di fabbrica, di un'altra versione.
  motore(moduli, '45.0.0');
  const dopo = F.motoreSenzaPrivilegi({ radice: clone, cache, piattaforma: 'linux' });
  expect(dopo, 'la copia nuova nasce').toMatchObject({ copia: true });
  expect(existsSync(dopo.dist)).toBe(true);
  expect(readdirSync(cache), 'nella cache resta solo la copia del motore in uso').toEqual([dopo.dist.split(/[\\/]/).pop()]);
});
