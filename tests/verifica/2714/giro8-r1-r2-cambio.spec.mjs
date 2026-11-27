// Verifica #2714 giro 8: forme del cambio che il correttore copre e il filtro principale no; password con lo spazio
// dopo il simbolo detta dopo la domanda. Logica pura, senza aprire Filo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const P = globalThis.SN_PAVIMENTO;
const C = require(join(ROOT, 'src', 'main', 'services', 'correttoreRiservati.js'));

test('r1 le forme del cambio coperte dal correttore lo sono anche dal filtro principale', () => {
  const passati = [];
  for (const [t, v] of [
    ['I set my PIN as 4821', '4821'],
    ['my pin is set as 4821', '4821'],
    ['cambiato il pin: ora 4821', '4821'],
    ['ho cambiato il pin in:4821', '4821'],
    ['ho cambiato il pin in 48-21', '48-21'],
    ['ho canbiato il pin in 4821', '4821'],
    ['ho cambaito il pin in 4821', '4821'],
    ['il pin è divntato 4821', '4821'],
    ['ho canbiato la password in Mela!Verde77', 'Mela!Verde77'],
    ['Hai cambiato la password? Era ora! Adesso è Mela!Verde77', 'Mela!Verde77'],
  ]) {
    if (C.oscura(t).includes(v)) continue;
    if (P.oscura(t).includes(v)) passati.push(t);
  }
  expect(passati).toEqual([]);
});

test('r2 la password con lo spazio dopo il simbolo detta dopo la domanda non arriva al modello, nemmeno a metà', () => {
  const passati = [];
  for (const t of [
    'Ti ricordi la password? Era Mela! Verde77',
    'Ti ricordi la password? È Mela! Verde77',
    'Hai cambiato la password? Sì, ora è Mela! Verde77',
    'Ti ricordi la password? Era Mela# Verde77',
  ]) {
    for (const [nome, f] of [['pavimento', P.oscura], ['correttore', C.oscura]]) {
      const out = f(t);
      if (/Mela|Verde77/.test(out)) passati.push(`${nome}: ${out}`);
    }
  }
  expect(passati).toEqual([]);
});
