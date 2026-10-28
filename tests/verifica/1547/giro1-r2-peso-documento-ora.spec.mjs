// Verifica #1547 giro 1: il documento più pesante che le regole accettano, sommando i tetti dei suoi campi, resta a
// decine di KB anche per l'ora e per i gesti, non solo per il giorno di prima.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGOLE = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'firestore.rules'), 'utf8');

function corpo(da, a) {
  const i = REGOLE.indexOf(da);
  return REGOLE.slice(i, REGOLE.indexOf(a, i + da.length));
}

function somma(testo) {
  let n = 0;
  for (const m of testo.matchAll(/chiuse\(d\.\w+, (?:\w+|\[[^\]]*\]), (\d+),/g)) n += Number(m[1]);
  for (const m of testo.matchAll(/aForma\(d\.\w+, '[^']*', (\d+), (\d+),/g)) n += Number(m[1]) + Number(m[2]);
  for (const m of testo.matchAll(/size\(\) <= (\d+)/g)) n += Number(m[1]);
  return n;
}

test('r2 il documento più pesante che le regole accettano pesa decine di KB', () => {
  const ora = somma(corpo('function misureOra(d)', 'function contatoriOra(d)')) + somma(corpo('function contatoriOra3(d)', 'function contatoriChat(d)'));
  const gesti = somma(corpo('function contatoriGesti(d)', 'allow get'));
  expect(ora, 'ora v3').toBeLessThanOrEqual(100000);
  expect(gesti, 'gesti').toBeLessThanOrEqual(100000);
});
