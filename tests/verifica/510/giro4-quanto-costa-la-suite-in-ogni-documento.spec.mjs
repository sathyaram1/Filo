// Verifica #510, giro 4 — il numero della suite va guardato in OGNI documento, non in due.
//
// Il giro 2 aveva corretto la guida di chi lavora, il giro 3 aveva segnalato
// l'altro documento: quello e ancora indietro, e ne resta fuori anche dalla
// guardia, che si e scritta l'elenco dei documenti a mano.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function documentiDelRepo() {
  const out = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return out.split('\n').filter(Boolean).filter((f) => !f.startsWith('patterns/'));
}

test('ogni documento del progetto dice quanto e grande la suite di oggi', () => {
  const elenco = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=list'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  const conto = elenco.match(/Total:\s*\d+\s+tests\s+in\s+(\d+)\s+files/);
  expect(conto, 'il raccoglitore deve dire quanti file raccoglie').not.toBeNull();
  const vero = Number(conto[1]);

  const sbagliati = [];
  for (const doc of documentiDelRepo()) {
    const testo = readFileSync(resolve(ROOT, doc), 'utf8');
    for (const m of testo.matchAll(/~\s*([\d.]+)\s+spec/g)) {
      const dichiarato = Number(m[1].replace(/\./g, ''));
      if (Math.abs(vero - dichiarato) / vero >= 0.05) sbagliati.push(`${doc}: ~${m[1]} spec`);
    }
  }
  expect(sbagliati.join(', '),
    `la suite raccoglie ${vero} file di prove: chi legge un documento rimasto indietro non vede il`
    + ' tempo che la pulizia ha restituito, e riparte da un numero vecchio')
    .toBe('');
});
