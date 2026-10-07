// Verifica #510, giro 3 — la guardia deve guardare TUTTO quello che la suite lancia.
//
// La segnalazione chiedeva che la regola smettesse di dipendere dalla memoria di
// chi scrive la prova. La guardia di oggi decide da sola su un elenco di file che
// si scrive a mano (solo .spec.mjs) mentre il raccoglitore della suite ne prende
// uno piu largo: quello che sta nella differenza non lo guarda nessuno.

import { test, expect } from '@playwright/test';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function guardiaRossa() {
  const r = spawnSync(process.execPath, ['--test', 'tests/unit/proveDeiGiri.test.mjs'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return r.status !== 0;
}

function suiteRaccoglie(nomeFile) {
  const out = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=list'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return out.includes(nomeFile);
}

test('una prova di passaggio non sfugge alla guardia cambiando estensione', () => {
  const nome = 'zz-giro3-510-estensione.spec.js';
  const file = resolve(ROOT, 'tests', nome);
  writeFileSync(file, [
    '// TEMP: prova usa-e-getta del giro 3. Delete after.',
    "import { test } from '@playwright/test';",
    "test('niente', async () => { console.log('nessun controllo'); });",
    '',
  ].join('\n'));
  try {
    expect(suiteRaccoglie(nome),
      'premessa: la suite completa lancia anche i file .spec.js, quindi una prova cosi le costa tempo vero')
      .toBe(true);
    expect(guardiaRossa(),
      'si dichiara di passaggio, non contiene nessun controllo e la suite la lancia lo stesso: la guardia'
      + ' non se ne accorge perche guarda solo i file che finiscono per .spec.mjs')
      .toBe(true);
  } finally {
    rmSync(file, { force: true });
  }
});

test('una prova di passaggio non sfugge dichiarandosi alla terza riga dell intestazione', () => {
  const nome = 'zz-giro3-510-terzariga.spec.mjs';
  const file = resolve(ROOT, 'tests', nome);
  writeFileSync(file, [
    '// Controllo del pannello laterale.',
    '// Ricostruisce il caso segnalato e guarda cosa succede.',
    '// Prova usa-e-getta: va cancellata dopo il giro.',
    "import { test, expect } from '@playwright/test';",
    "test('x', () => { expect(1).toBe(1); });",
    '',
  ].join('\n'));
  try {
    expect(guardiaRossa(),
      'la guida di chi lavora concede tre righe di intestazione, la guardia ne legge due: una prova che'
      + ' dice di se stessa di essere di passaggio sulla terza riga resta nella suite per sempre')
      .toBe(true);
  } finally {
    rmSync(file, { force: true });
  }
});

test('la memoria di un giro su un seguito di segnalazione si puo ritrovare', () => {
  const cartella = resolve(ROOT, 'tests', 'verifica', '379.3');
  mkdirSync(cartella, { recursive: true });
  writeFileSync(resolve(cartella, 'giro1-finta.spec.mjs'), [
    '// Prova finta, per controllare che una cartella di seguito sia accettata.',
    "import { test, expect } from '@playwright/test';",
    "test('x', () => { expect(1).toBe(1); });",
    '',
  ].join('\n'));
  try {
    expect(guardiaRossa(),
      'le segnalazioni hanno anche dei seguiti (#379.3): chi verifica un seguito da alla cartella il numero'
      + ' del seguito, e la guardia lo rifiuta come se fosse un nome inventato')
      .toBe(false);
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
});
