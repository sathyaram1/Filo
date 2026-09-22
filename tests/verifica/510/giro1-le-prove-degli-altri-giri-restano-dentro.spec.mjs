// Verifica #510, giro 1 — la stessa causa, l'altra porta.
//
// La segnalazione chiedeva di togliere dalla suite le prove nate per
// controllare UN ritrovamento, e di smettere di farlo dipendere da come chi
// lavora battezza il file. Vale per ogni giro che ne scrive, non solo per
// quello che verifica: qui si prova che la suite non se ne porta più dietro
// nessuna, comunque si chiami il file e qualunque giro l'abbia scritto.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Il contenuto non importa niente: un import dentro una stringa confonde i controlli che leggono i sorgenti.
const SONDA = "test('x', () => {});\n";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function specDellaSuite() {
  return execFileSync('git', ['ls-files', '-z', 'tests/*.spec.mjs'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  }).split('\0').filter(Boolean)
    // Le prove dei giri stanno fuori dalla suite di proposito: qui si guarda cosa la suite si porta dietro.
    .filter((f) => !f.startsWith('tests/verifica/'));
}

test('nessuna prova che si dichiara usa-e-getta è rimasta nella suite', () => {
  const usaEGetta = specDellaSuite().filter((f) => {
    const testa = readFileSync(resolve(ROOT, f), 'utf8').slice(0, 600);
    return /\b(throwaway|TEMP\b|Delete after|usa-e-getta|per ispezione)/i.test(testa);
  });
  expect(usaEGetta,
    'ognuna riapre Filo a ogni corsa della suite, e non asserisce niente che un utente possa perdere')
    .toEqual([]);
});

test('ogni prova della suite asserisce qualcosa: nessuna è solo esplorazione', () => {
  const mute = specDellaSuite().filter((f) => {
    // L'import di `expect` non conta: quello che conta è se la prova lo USA.
    const src = readFileSync(resolve(ROOT, f), 'utf8').replace(/^\s*import[^;]*;/gm, '');
    return !/\bexpect\s*[.(]/.test(src);
  });
  expect(mute, 'una prova che non asserisce niente non può diventare rossa: costa e basta').toEqual([]);
});

test('una prova di giro non entra nella suite nemmeno se chi la scrive la battezza a modo suo', () => {
  // Il nome è l'unica cosa che nessuno ricorda: il controllo non deve dipenderci.
  const sentinella = resolve(ROOT, 'tests/unit/proveDeiGiri.test.mjs');
  const nomi = ['controllo-510-sonda.spec.mjs', 'audit-510-sonda.spec.mjs', 'zzsonda-510.spec.mjs'];
  const sfuggiti = [];
  for (const nome of nomi) {
    const f = resolve(ROOT, 'tests', nome);
    try {
      writeFileSync(f, SONDA);
      try { execFileSync('node', ['--test', sentinella], { cwd: ROOT, encoding: 'utf8' }); sfuggiti.push(nome); }
      catch { /* rossa: la prova fuori posto si vede, ed è quello che deve succedere */ }
    } finally { rmSync(f, { force: true }); }
  }
  expect(sfuggiti,
    'con questi nomi la prova resta nella suite in silenzio e il salvataggio automatico la committa')
    .toEqual([]);
});

test('i nomi che la suite sa riconoscere restano riconosciuti', () => {
  const sentinella = resolve(ROOT, 'tests/unit/proveDeiGiri.test.mjs');
  const f = resolve(ROOT, 'tests', 'verify-510-sonda.spec.mjs');
  let rosso = false;
  try {
    writeFileSync(f, SONDA);
    try { execFileSync('node', ['--test', sentinella], { cwd: ROOT, encoding: 'utf8' }); } catch { rosso = true; }
  } finally { rmSync(f, { force: true }); }
  expect(rosso).toBe(true);
});
