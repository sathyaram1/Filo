// Prove del giro 1 (verifica locale) sugli attriti del canale delle routine: diff a parte, base dichiarata,
// guardia del ramo durante un rebase. Non aprono Filo: la cosa chiesta vive negli strumenti delle routine,
// e si prova usandoli su repository git veri creati apposta (mai sulla cartella di lavoro).

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const importa = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const GUARDIA = resolve(ROOT, '.claude', 'hooks', 'branch-guard.sh');
const BASH = process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
  ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
// Oltre questa taglia l'uscita di un comando dell'harness finisce in un file (la soglia che il lavoro stesso assume).
const SOGLIA_STAMPA = 30000;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitProva(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}
function repoNuovo(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
}
function scrivi(dir, nome, testo) { writeFileSync(join(dir, nome), testo); }
function commit(dir, msg) { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); }

// Cattura la stampa di `emit`: è esattamente quello che il lavoratore riceve da `dispatch --ticket`.
function stampa(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  let s = '';
  process.stdout.write = (c) => { s += c; return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return s;
}
// `emit` lascia il marcatore di ruolo nella cartella di lavoro: la prova non deve lasciarlo lì.
const MARCATORE = resolve(ROOT, '.claude', 'routine-role.json');
function senzaMarcatore(fn) {
  const cera = existsSync(MARCATORE);
  try { return fn(); } finally { if (!cera) rmSync(MARCATORE, { force: true }); }
}

test('controllo sicurezza: diff da 90.000 caratteri intero in un file, base dichiarata, main locale indietro', async () => {
  const d = await importa('scripts/dispatch.mjs');
  const T = cartellaTemporanea('attriti-diff-');
  const origine = join(T, 'origine');
  const clone = join(T, 'clone');
  mkdirSync(origine);
  repoNuovo(origine);
  scrivi(origine, 'a.txt', 'uno\n'); commit(origine, 'c1');
  git(T, 'clone', '-q', origine, clone);
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['core.autocrlf', 'false']]) git(clone, 'config', k, v);
  // main su origin avanza, il ramo viene rifatto sopra: il main locale del clone resta indietro.
  scrivi(origine, 'gia-su-main.txt', 'modifica gia fusa\n'); commit(origine, 'main avanza');
  git(clone, 'fetch', '-q', 'origin');
  git(clone, 'checkout', '-q', '-b', 'claude/lavoro', 'origin/main');
  const grosso = Array.from({ length: 1800 }, (_, i) => `riga ${i}: contenuto del lavoro, abbastanza lungo`).join('\n') + '\n';
  scrivi(clone, 'lavoro.txt', grosso);
  scrivi(clone, 'emoji.txt', 'caffè ☕ 🙂 <b>markup</b>\n');
  commit(clone, 'lavoro');
  const localeGonfio = git(clone, 'diff', 'main...claude/lavoro');
  expect(localeGonfio).toContain('gia-su-main.txt');

  const r = d.diffForBranch('claude/lavoro', clone);
  const ctx = d.serverCtx({ role: 'secaudit', branch: 'claude/lavoro' }, null, r);
  const out = senzaMarcatore(() => stampa(() => d.emit({ role: 'secaudit', branch: 'claude/lavoro', id: 'idfinto123', num: '999' }, ctx)));
  const j = JSON.parse(out);
  const p = j.payload;

  expect(out.length).toBeLessThan(SOGLIA_STAMPA);
  expect(p.diff).toBeUndefined();
  expect(p.diffBase.ref).toBe('origin/main');
  expect(p.diffBase.sha).toBe(git(clone, 'rev-parse', 'origin/main'));
  expect(p.diffHead).toBe(git(clone, 'rev-parse', 'claude/lavoro'));
  const nelFile = readFileSync(p.diffFile, 'utf8');
  expect(nelFile.length).toBe(p.diffCaratteri);
  expect(nelFile.length).toBeGreaterThan(85000);
  expect(nelFile).not.toContain('gia-su-main.txt');
  expect(nelFile).toContain('riga 1799: contenuto del lavoro');
  expect(nelFile).toContain('☕ 🙂 <b>markup</b>');
  // Il comando dichiarato, rilanciato da chi controlla, dà lo stesso diff.
  const [, ...argsComando] = p.diffComando.split(' ');
  expect(execFileSync('git', argsComando, { cwd: clone, encoding: 'utf8' })).toBe(nelFile);
  // Il ruolo si legge dalla stampa, senza script.
  expect(j.instructions).toContain('secaudit');
});

function repoConRebase(backend) {
  const T = cartellaTemporanea('attriti-rebase-');
  repoNuovo(T);
  scrivi(T, 'a.txt', 'base\n'); commit(T, 'base');
  git(T, 'checkout', '-q', '-b', 'claude/lavoro');
  scrivi(T, 'a.txt', 'dal ramo\n'); commit(T, 'ramo');
  git(T, 'checkout', '-q', '-b', 'altro', 'main');
  scrivi(T, 'a.txt', 'da altro\n'); commit(T, 'altro');
  git(T, 'checkout', '-q', 'main');
  scrivi(T, 'a.txt', 'da main\n'); commit(T, 'main');
  git(T, 'checkout', '-q', 'claude/lavoro');
  return { T, backend };
}
function avviaRebase({ T, backend }, ramo) {
  git(T, 'checkout', '-q', ramo);
  const r = gitProva(T, 'rebase', ...(backend === 'apply' ? ['--apply'] : []), 'main');
  expect(r.status).not.toBe(0);
  expect(git(T, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
}
function guardia(T) {
  return spawnSync(BASH, [GUARDIA], { cwd: T, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: T }, input: '{}' });
}

for (const backend of ['merge', 'apply']) {
  test(`guardia del ramo durante il rebase del ramo assegnato (${backend}): dice di finirlo, non FERMATI; registrare resta vietato`, async () => {
    const bi = await importa('scripts/lib/branch-integrity.mjs');
    const repo = repoConRebase(backend);
    const { T } = repo;
    bi.writeExpectation(T, { branch: 'claude/lavoro', id: 'idfinto123' });

    avviaRebase(repo, 'claude/lavoro');
    const g = guardia(T);
    expect(g.status).toBe(0);
    expect(g.stderr).not.toContain('FERMATI');
    const msg = JSON.parse(g.stdout).hookSpecificOutput;
    expect(msg.hookEventName).toBe('PostToolUse');
    expect(msg.additionalContext).toMatch(/rebase/i);
    expect(msg.additionalContext).toMatch(/--continue/);

    const v = bi.checkDelivery(T, 'claude/lavoro');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/rebase in corso/);

    // Portato a termine: la guardia tace e la registrazione torna possibile.
    scrivi(T, 'a.txt', 'risolto\n');
    git(T, 'add', 'a.txt');
    const fine = spawnSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: T, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
    expect(fine.status).toBe(0);
    const dopo = guardia(T);
    expect(dopo.status).toBe(0);
    expect(dopo.stdout.trim()).toBe('');
    expect(bi.checkDelivery(T, 'claude/lavoro').ok).toBe(true);
  });
}

test('guardia del ramo: il rebase di un ALTRO ramo resta una deriva (FERMATI), e anche la registrazione è rifiutata', async () => {
  const bi = await importa('scripts/lib/branch-integrity.mjs');
  const repo = repoConRebase('merge');
  const { T } = repo;
  bi.writeExpectation(T, { branch: 'claude/lavoro', id: 'idfinto123' });
  avviaRebase(repo, 'altro');
  const g = guardia(T);
  expect(g.status).toBe(2);
  expect(g.stderr).toContain('FERMATI');
  expect(bi.checkDelivery(T, 'claude/lavoro').ok).toBe(false);
});
