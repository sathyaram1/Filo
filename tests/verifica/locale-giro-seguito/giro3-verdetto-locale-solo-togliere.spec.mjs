// Prove del giro 3 (verifica locale) sul lavoro «seguito del giro», punto 4 in
// locale: dopo il pass, dalle prove del giro si può solo togliere. Repo git vero in
// una cartella temporanea, esito letto come lo legge la chiusura.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { verdictForCurrentBranch, writeState } from '../../../scripts/verify-local.mjs';
import { specDaRilanciare } from '../../../scripts/finish-local.mjs';

const PROVA = 'tests/verifica/locale-prova/giro1-salvataggio.spec.mjs';
const CORPO = [
  "import { test, expect } from '@playwright/test';",
  "test('caso uno', async () => {",
  '  expect(1).toBe(1);',
  '});',
  "test('caso due', async () => {",
  '  expect(2).toBe(2);',
  '});',
  '',
].join('\n');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Un ramo con una verifica passata sul commit di adesso. */
function ramoVerificato() {
  const repo = join(cartellaTemporanea('giro3-solo-togliere-'), 'repo');
  mkdirSync(join(repo, 'tests', 'verifica', 'locale-prova'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  writeFileSync(join(repo, 'src', 'salva.js'), 'export const salva = () => true;\n');
  writeFileSync(join(repo, PROVA), CORPO);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'lavoro verificato');
  const sha = git(repo, 'rev-parse', 'HEAD');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeState(repo, { 'claude/prova': { request: 'r', requestedSha: sha, verdict: 'pass', sha, critique: 'ok', rounds: [], derived: [] } });
  return repo;
}

function commit(repo) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'dopo il verdetto');
}

const senzaCasoDue = CORPO.split('\n').slice(0, 4).concat(['']).join('\n');

test.describe('verdetto locale: dopo il pass dalle prove del giro si può solo togliere', () => {
  test('un caso tolto da una prova che ne ha altri: il verdetto regge, e la chiusura salta gli spec delle aree', () => {
    const repo = ramoVerificato();
    writeFileSync(join(repo, PROVA), senzaCasoDue);
    commit(repo);
    const r = verdictForCurrentBranch(repo);
    expect(r.ok, r.reason).toBe(true);
    expect(specDaRilanciare({ checkOnly: false, ok: r.ok, sha: r.entry.sha, tollerato: r.tollerato }).rilancia ?? specDaRilanciare({ checkOnly: false, ok: r.ok, sha: r.entry.sha, tollerato: r.tollerato })).toBeFalsy();
  });

  test('una prova tolta per intero: il verdetto regge', () => {
    const repo = ramoVerificato();
    rmSync(join(repo, PROVA));
    commit(repo);
    expect(verdictForCurrentBranch(repo).ok).toBe(true);
  });

  test('un marcatore di rosso atteso aggiunto dopo il verdetto lo fa decadere', () => {
    const repo = ramoVerificato();
    writeFileSync(join(repo, PROVA), CORPO.replace("  expect(2).toBe(2);", "  test.fail(true, 'rosso atteso');\n  expect(2).toBe(2);"));
    commit(repo);
    const r = verdictForCurrentBranch(repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/dell'altro/);
  });

  test('un caso tolto insieme a una riga cambiata, o una riga spostata, lo fa decadere', () => {
    const repo = ramoVerificato();
    writeFileSync(join(repo, PROVA), senzaCasoDue.replace('toBe(1)', 'toBe(2)'));
    commit(repo);
    expect(verdictForCurrentBranch(repo).ok).toBe(false);
    const repo2 = ramoVerificato();
    const righe = CORPO.split('\n');
    writeFileSync(join(repo2, PROVA), [righe[0], ...righe.slice(4, 7), ...righe.slice(1, 4), ''].join('\n'));
    commit(repo2);
    expect(verdictForCurrentBranch(repo2).ok).toBe(false);
  });

  test('una prova del giro spostata fuori dalla cartella lo fa decadere', () => {
    const repo = ramoVerificato();
    renameSync(join(repo, PROVA), join(repo, 'tests', 'giro1-salvataggio.spec.mjs'));
    commit(repo);
    expect(verdictForCurrentBranch(repo).ok).toBe(false);
  });

  test('un caso tolto e il codice toccato nello stesso commit: decade', () => {
    const repo = ramoVerificato();
    writeFileSync(join(repo, PROVA), senzaCasoDue);
    writeFileSync(join(repo, 'src', 'salva.js'), 'export const salva = () => false;\n');
    commit(repo);
    expect(verdictForCurrentBranch(repo).ok).toBe(false);
  });

  test('un caso tolto ma non salvato in un commit: non si pubblica', () => {
    const repo = ramoVerificato();
    writeFileSync(join(repo, PROVA), senzaCasoDue);
    expect(verdictForCurrentBranch(repo).ok).toBe(false);
    expect(readFileSync(join(repo, PROVA), 'utf8')).toBe(senzaCasoDue);
  });
});
