// Verifica locale, giro 1 (ramo claude/attriti-verifica): la consegna della correzione si ferma quando
// chi corregge fa sparire una prova del giro ancora rossa. Niente Electron: un repo usa-e-getta.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAMO = 'claude/prova-giro';
const PROVA = 'tests/verifica/77/giro1-rilievi.spec.mjs';
const ROSSO = "test('la porta del rilievo corretto', () => { expect(1).toBe(2); });";
const VERDE = "test('una porta chiusa davvero', () => { expect(1).toBe(1); });";
const REPORT = 'Corretto il rilievo del giro: il pulsante ora salva anche col titolo vuoto, provato a mano e con la prova.';

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
}

// Un npx finto che risponde «rosso» a ogni prova: così la prova tolta, rilanciata, è ancora rossa.
function npxRosso(dir) {
  const bin = join(dir, '..', `${dir.split(/[\\/]/).pop()}-bin`);
  mkdirSync(bin, { recursive: true });
  cartelle.push(bin);
  writeFileSync(join(bin, 'npx.cmd'), '@echo prova rossa\r\n@exit /b 1\r\n');
  writeFileSync(join(bin, 'npx'), '#!/bin/sh\necho prova rossa\nexit 1\n');
  try { chmodSync(join(bin, 'npx'), 0o755); } catch (_) {}
  return bin;
}

/** Un giro locale aperto: la critica su `prima`, poi il commit di chi corregge. */
function giroAperto({ contenutoPrima, contenutoDopo, external }) {
  const dir = cartellaTemporanea('giro-prove-tolte-');
  cartelle.push(dir);
  git(dir, 'init', '-q', '-b', RAMO);
  writeFileSync(join(dir, '.gitignore'), '.claude/\ntests/verifica/_tolte-*/\n');
  mkdirSync(join(dir, dirname(PROVA)), { recursive: true });
  writeFileSync(join(dir, PROVA), contenutoPrima);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'critica');
  const prima = git(dir, 'rev-parse', 'HEAD');
  if (contenutoDopo === null) rmSync(join(dir, PROVA));
  else writeFileSync(join(dir, PROVA), contenutoDopo);
  writeFileSync(join(dir, 'codice.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'correzione');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'verify-local.json'), JSON.stringify({
    [RAMO]: {
      request: 'correggi il pulsante', verdict: 'fix-pending', rounds: [{ outcome: '' }],
      pending: {
        sha: prima, at: new Date().toISOString(), budgets: null, derived: [], external,
        findings: [{ level: 2, sede: 'i', text: 'Il pulsante non salva col titolo vuoto' }],
      },
    },
  }, null, 2));
  return dir;
}

function consegna(dir) {
  const bin = npxRosso(dir);
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-local.mjs'), 'corretto', REPORT], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: dir, PATH: `${bin}${delimiter}${process.env.PATH}` },
  });
  const stato = JSON.parse(readFileSync(join(dir, '.claude', 'verify-local.json'), 'utf8'))[RAMO];
  return { status: r.status, testo: `${r.stdout}\n${r.stderr}`, verdict: stato.verdict };
}

const cartelle = [];
test.afterAll(() => {
  for (const d of cartelle) rmSync(d, { recursive: true, force: true });
});

const intesta = "import { test, expect } from '@playwright/test';\n";

test('una prova cancellata ancora rossa ferma la consegna anche se il giro ha un rilievo esterno', () => {
  test.fail(true, 'in attesa della scelta dell\'owner: una prova di un esterno la può togliere anche chi corregge');
  const dir = giroAperto({
    contenutoPrima: `${intesta}${ROSSO}\n`, contenutoDopo: null,
    external: [{ level: 1, sede: 'e', text: 'Il bordo del menu è grigio: c\'era già su main' }],
  });
  const r = consegna(dir);
  expect(r.testo).toContain('giro1-rilievi.spec.mjs');
  expect(r.status, r.testo).not.toBe(0);
  expect(r.verdict).toBe('fix-pending');
});

test('togliere il caso rosso da una prova che resta ferma la consegna come cancellarla', () => {
  const dir = giroAperto({
    contenutoPrima: `${intesta}${ROSSO}\n${VERDE}\n`, contenutoDopo: `${intesta}${VERDE}\n`, external: [],
  });
  const r = consegna(dir);
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('giro1-rilievi.spec.mjs');
  expect(r.verdict).toBe('fix-pending');
});

test('controllo: la prova cancellata ancora rossa, senza rilievi messi da parte, ferma già oggi', () => {
  const dir = giroAperto({ contenutoPrima: `${intesta}${ROSSO}\n`, contenutoDopo: null, external: [] });
  const r = consegna(dir);
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('giro1-rilievi.spec.mjs');
  expect(r.verdict).toBe('fix-pending');
});
