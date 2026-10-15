// Verifica #794 giro 1: le spie che il ramo ha tolto dal testo del ruolo («prima di ogni correzione», «anche dopo
// le correzioni», accanto a chi ha registrato la critica) restano nell'intestazione di verify-local e nel pattern
// che CLAUDE.md nomina per le prove del giro.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPIA = /(?:prima di ogni|anche dopo le) correzion/i;

const intestazione = (f) => {
  const righe = [];
  for (const r of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
    if (!/^\s*(\/\/|$)/.test(r)) break;
    righe.push(r.replace(/^\s*\/\/\s?/, ''));
  }
  return righe.join(' ');
};

test('r1 i testi che si incontrano senza cercarli non mettono la pulizia prima o dopo le correzioni', () => {
  const superfici = {
    'intestazione di verify-local': intestazione('scripts/verify-local.mjs'),
    'pattern delle prove del giro': readFileSync(join(ROOT, 'patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md'), 'utf8'),
  };
  const colpevoli = Object.entries(superfici)
    .map(([nome, t]) => [nome, t.replace(/\s+/g, ' ').match(SPIA)])
    .filter(([, m]) => m)
    .map(([nome, m]) => `${nome}: ${m[0]}`);
  expect(colpevoli).toEqual([]);
});
