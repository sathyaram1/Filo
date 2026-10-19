// #1121 giro 2 e 3: le novità degli host stanno sotto una versione non ancora uscita (la 0.2.242 è già fuori).

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const radice = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const numero = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);

test('r1 la riga «Host dei modelli» del changelog sta sotto una versione successiva all\'ultima uscita', () => {
  require(join(radice, 'src', 'shared', 'patchNotes.js'));
  const note = globalThis.SN_PATCH_NOTES;
  const blocchi = Array.isArray(note) ? note : (note.NOTES || note.notes || note.list || Object.values(note).find(Array.isArray));
  const blocco = blocchi.find((b) => [...(b.features || []), ...(b.fixes || [])].some((r) => String(r).includes('Host dei modelli')));
  expect(blocco, 'la riga sugli host non c\'è').toBeTruthy();
  expect(numero(blocco.version), `la riga sta sotto la ${blocco.version}, già uscita`).toBeGreaterThan(numero('0.2.242'));
});
