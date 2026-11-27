// Verifica #2502 giro 2: la mappa della corsa della suite su questo lavoro, interrogata come la interrogano chi lavora e
// il controllo di fine lavoro. r1: la soglia di compattazione di serie, letta da un altro modulo; r2: i file delle prove.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { leggiMappa } from '../../../scripts/mappa-prove.mjs';
import { sceltaDallaMappa } from '../../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// La corsa della suite lanciata su questo lavoro: la sua mappa sta nel registro del verdetto.
const CORSA = '46049696468';

test('r1 cambiare la soglia di compattazione di serie fa lanciare al controllo di fine lavoro la prova della compattazione', () => {
  test.setTimeout(120_000);
  const letta = leggiMappa({ corsa: CORSA, root: ROOT });
  expect(letta.errore).toBeUndefined();
  const wt = join(cartellaTemporanea('filo-v2502g2-'), 'albero');
  execFileSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
  try {
    const rel = 'src/shared/filoContesto.js';
    const testo = readFileSync(join(wt, rel), 'utf8');
    expect(testo).toContain('soglia: 70000');
    writeFileSync(join(wt, rel), testo.replace('soglia: 70000', 'soglia: 60000'));
    const scelta = sceltaDallaMappa({ mappa: letta.mappa, file: [rel], base: 'HEAD', root: wt });
    // La prova della compattazione scrive la soglia di serie nel campo delle Preferenze: è lei che il cambio rompe.
    expect(scelta.specs).toContain('tests/compattazione');
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' });
    rmSync(dirname(wt), { recursive: true, force: true });
  }
});

function chiedi(args, input) {
  const out = JSON.parse(execFileSync(process.execPath, ['scripts/mappa-prove.mjs', '--corsa', CORSA, '--json', ...args], { cwd: ROOT, encoding: 'utf8', input }));
  return [...out.prove.map((p) => p.spec), ...(out.specDelRamo || [])];
}

test('r2 un aiuto delle prove nomina le prove che lo usano, e una prova cambiata nomina se stessa', () => {
  test.setTimeout(120_000);
  expect(chiedi(['tests/helpers/chatFinta.mjs'])).toContain('tests/compattazione.spec.mjs');
  const rel = 'tests/compattazione.spec.mjs';
  const riga = readFileSync(join(ROOT, rel), 'utf8').split('\n')[44];
  const diff = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -45,1 +45,1 @@\n-${riga}\n+${riga} \n`;
  expect(chiedi(['--diff', '-'], diff)).toContain(rel);
});
