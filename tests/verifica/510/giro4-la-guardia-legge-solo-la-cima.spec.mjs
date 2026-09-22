// Verifica #510, giro 4 — una prova si dichiara di passaggio dove le viene, non solo in cima.
//
// La guardia legge il blocco di commenti che apre il file e si ferma alla prima
// riga di codice. Sedici prove della suite aprono con gli import e mettono il
// commento sotto: scritta cosi, una prova che dice di se stessa di essere
// usa-e-getta passa liscia e resta nella suite per sempre.

import { test, expect } from '@playwright/test';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
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

// Il controllo c'e ed e vero: cosi l'unica regola che puo farla cadere e quella
// della dichiarazione, e il rosso non arriva per un altro motivo.
const CORPO = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('sonda', async () => { expect(1 + 1).toBe(2); });",
  '',
];

function conProva(nome, righe, controllo) {
  const file = resolve(ROOT, 'tests', nome);
  writeFileSync(file, righe.join('\n'));
  try {
    expect(suiteRaccoglie(nome), 'premessa: la suite completa la lancia, quindi le costa tempo vero').toBe(true);
    controllo();
  } finally {
    rmSync(file, { force: true });
  }
}

test('una prova che si dichiara di passaggio sotto gli import non sfugge', () => {
  conProva('zz-giro4-510-sotto-import.spec.mjs', [
    ...CORPO.slice(0, 2),
    '// AUDIT: riproduce il sospetto per guardarlo a occhio.',
    '// Prova usa-e-getta: va cancellata dopo il giro.',
    ...CORPO.slice(2),
  ], () => {
    expect(guardiaRossa(),
      'la prova dice di se stessa di essere usa-e-getta, ma lo dice sotto gli import: la guardia ha'
      + ' gia smesso di leggere e la lascia dentro alla suite per sempre')
      .toBe(true);
  });
});

test('una prova che si dichiara di passaggio accanto al suo controllo non sfugge', () => {
  conProva('zz-giro4-510-dentro-il-corpo.spec.mjs', [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('sonda', async () => {",
    '  // TEMP, throwaway: serve solo a questo giro, poi si butta.',
    '  expect(1 + 1).toBe(2);',
    '});',
    '',
  ], () => {
    expect(guardiaRossa(),
      'la dichiarazione sta accanto al controllo invece che in cima, e nessuno la legge')
      .toBe(true);
  });
});
