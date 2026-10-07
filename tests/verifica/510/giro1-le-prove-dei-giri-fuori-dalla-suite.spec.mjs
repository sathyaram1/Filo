// Verifica #510, giro 1 — le prove usa-e-getta non allungano più la suite.
//
// La segnalazione chiedeva due cose: togliere dalla suite quelle già entrate e
// smettere di dipendere dalla memoria di chi le scrive. Qui si prova il
// risultato dal di fuori, chiedendo alla suite cosa raccoglie davvero: la
// forma dell'esclusione non conta, conta che il conto non cresca a ogni giro e
// che le prove restino rilanciabili per numero.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Si interroga il collettore vero, non la configurazione: è l'unica risposta
// che vale anche se domani l'esclusione cambia forma.
function elenca(args, env = {}) {
  return execFileSync('npx', ['playwright', 'test', ...args, '--list', '--reporter=list'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...env },
  });
}

test('la suite completa non raccoglie nessuna prova di giro', () => {
  const out = elenca([]);
  const righe = out.split('\n').filter((r) => /verifica[\\/]/.test(r));
  expect(righe, 'una prova di un giro passato nella suite completa: ogni file riapre Filo').toEqual([]);
});

test('le prove di un giro si rilanciano nominando il loro numero', () => {
  const out = elenca(['tests/verifica/410']);
  expect(out).toMatch(/verifica[\\/]410[\\/]/);
  expect(out, 'nominare la cartella deve spegnere il filtro, altrimenti «No tests found» a cartella piena')
    .not.toMatch(/Total: 0 tests/);
});

test('tutte insieme si raccolgono solo se chi lancia lo chiede', () => {
  const out = elenca([], { FILO_TEST_VERIFICA: '1' });
  expect(out).toMatch(/verifica[\\/]/);
});

test('una prova di giro messa nel posto sbagliato si vede subito, senza aspettare nessuno', () => {
  const sentinella = resolve(ROOT, 'tests/unit/proveDeiGiri.test.mjs');
  expect(existsSync(sentinella)).toBe(true);
  const fuoriposto = resolve(ROOT, 'tests/verify-510-sonda-temporanea.spec.mjs');
  try {
    writeFileSync(fuoriposto, "test('x', () => {});\n");
    let rosso = false;
    try { execFileSync('node', ['--test', sentinella], { cwd: ROOT, encoding: 'utf8' }); }
    catch { rosso = true; }
    expect(rosso, 'il posto sbagliato deve diventare rosso da solo: è questo che toglie la regola dalla memoria').toBe(true);
  } finally {
    rmSync(fuoriposto, { force: true });
  }
});

test('nessun sorgente del repo è diventato binario per un byte nullo', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter(Boolean);
  const binari = files
    .filter((f) => /\.(mjs|js|json|md|html|css|txt)$/.test(f))
    .filter((f) => readFileSync(resolve(ROOT, f)).includes(0));
  expect(binari, 'un byte nullo crudo rende il file illeggibile a git: si scrive come escape').toEqual([]);
});
