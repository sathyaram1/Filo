// #1680 giro 6, rilievi 10 e 13 (parte dell'app): una riga di codice spostata in un'altra funzione dello stesso file è
// una modifica riscritta dal riallineamento; il motivo del correttore si legge giusto con «;» o con spazi nei nomi.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { fileRiscritti } from '../../../scripts/lib/su-main.mjs';

createRequire(import.meta.url)('../../../src/shared/verifierRound.js');
const R = globalThis.SN_VERIFIER_ROUND;
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const auth = (guardiaIn) => [
  'function salva(utente) {', '  const db = apri();', ...(guardiaIn === 'salva' ? ['  if (!utente) return;'] : []), '  db.scrivi(utente);', '}', '',
  ...Array.from({ length: 20 }, (_, i) => `// riga ${i}`), '',
  'function cancella(utente) {', '  const db = apri();', ...(guardiaIn === 'cancella' ? ['  if (!utente) return;'] : []), '  db.togli(utente);', '}', '',
].join('\n');

test('r10 il correttore sposta il controllo da salva() a cancella(), stesso testo: il file risulta riscritto', () => {
  const repo = cartellaTemporanea('filo-1680-g6r10-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'prova@filo.invalid');
  git(repo, 'config', 'user.name', 'prova');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'auth.js'), auth(''));
  writeFileSync(join(repo, 'src', 'altro.js'), 'uno\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'inizio');
  // La punta verificata: la guardia in salva().
  git(repo, 'checkout', '-q', '-b', 'lavoro');
  writeFileSync(join(repo, 'src', 'auth.js'), auth('salva'));
  git(repo, 'commit', '-q', '-am', '#12 guardia');
  const prima = git(repo, 'rev-parse', 'HEAD');
  // Main va avanti altrove; il riallineamento rifà il ramo su main con la guardia finita in cancella().
  git(repo, 'checkout', '-q', 'main');
  writeFileSync(join(repo, 'src', 'altro.js'), 'due\n');
  git(repo, 'commit', '-q', '-am', 'altro lavoro');
  git(repo, 'checkout', '-q', '-b', 'riallineato');
  writeFileSync(join(repo, 'src', 'auth.js'), auth('cancella'));
  git(repo, 'commit', '-q', '-am', '#12 guardia');
  const r = fileRiscritti(repo, { prima, dopo: 'HEAD', base: 'main' });
  expect(r.ok, r.errore).toBe(true);
  expect(r.file, 'la logica spostata non chiede la verifica').toContain('src/auth.js');
});

test('r13 motivo coi file di servizio separati da punto e virgola: niente verifica intera', () => {
  const m = R.leggiMotivoCorrettore('conflitto: src/shared/patchNotes.js; src/shared/capabilities.js');
  expect(m.ok, m.errore).toBe(true);
  expect(R.giroDopoRiallineamento([], { conflitti: m.motivo.file })).toEqual({ giro: 'nessuno', codice: [] });
});

test('r13 motivo con un file che ha spazi nel nome: il nome resta intero', () => {
  const m = R.leggiMotivoCorrettore('conflitto: tests/fixtures/pagina con spazi.html, src/shared/patchNotes.js');
  expect(m.ok, m.errore).toBe(true);
  expect(m.motivo.file).toEqual(['tests/fixtures/pagina con spazi.html', 'src/shared/patchNotes.js']);
});
