// Verifica #510, giro 3 — il costo della suite e scritto in piu posti: devono dire tutti lo stesso.
//
// Il giro 2 aveva chiesto che la guida smettesse di dichiarare una suite piu
// grande di quella vera. E stata corretta la guida, non l altro documento che
// dice lo stesso numero: chi legge quello riparte ancora dal numero vecchio.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOCUMENTI = ['CLAUDE.md', 'README.md'];

test('ogni documento che dice quanto e grande la suite dice il numero vero', () => {
  const elenco = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=list'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  const conto = elenco.match(/Total:\s*\d+\s+tests\s+in\s+(\d+)\s+files/);
  expect(conto, 'il collettore deve dire quanti file raccoglie').not.toBeNull();
  const vero = Number(conto[1]);

  const sbagliati = [];
  for (const doc of DOCUMENTI) {
    const testo = readFileSync(resolve(ROOT, doc), 'utf8');
    for (const m of testo.matchAll(/~\s*([\d.]+)\s+spec/g)) {
      const dichiarato = Number(m[1].replace(/\./g, ''));
      if (Math.abs(vero - dichiarato) / vero >= 0.05) sbagliati.push(`${doc}: ~${m[1]} spec`);
    }
  }
  expect(sbagliati.join(', '),
    `la suite raccoglie ${vero} file di prove: chi legge un documento che ne dichiara molti di piu non`
    + ' vede il tempo che la pulizia ha restituito, e riparte da un numero vecchio')
    .toBe('');
});
