// Prove del giro 2 (verifica locale) sugli attriti del canale: diff identico a git, guardia del ramo nei rebase
// che non sono il caso base (worktree, pull, stop senza conflitto). La taglia delle consegne sta in giro4-r2.
// Non aprono Filo: la cosa chiesta vive negli strumenti delle routine, provati su repository creati apposta.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const importa = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const GUARDIA = resolve(ROOT, '.claude', 'hooks', 'branch-guard.sh');
const BASH = process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
  ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

// Il marcatore di ruolo e la cartella dei file di consegna vanno in una radice finta, non nel repo.
process.env.FILO_REPO_ROOT = cartellaTemporanea('attriti-radice-');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitGrezzo(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function repoNuovo(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
}
function scrivi(dir, nome, testo) { writeFileSync(join(dir, nome), testo); }
function commit(dir, msg) { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); }
function stampa(fn) {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let s = '';
  let err = '';
  process.stdout.write = (c) => { s += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  try { fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
  return { s, err };
}
test('il diff nel file è identico byte per byte a quello di git, spazi finali e ultimo a capo compresi', async () => {
  const d = await importa('scripts/dispatch.mjs');
  const T = cartellaTemporanea('attriti-spazi-');
  const origine = join(T, 'origine');
  const clone = join(T, 'clone');
  mkdirSync(origine);
  repoNuovo(origine);
  scrivi(origine, 'a.txt', 'uno\n'); commit(origine, 'c1');
  git(T, 'clone', '-q', origine, clone);
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['core.autocrlf', 'false']]) git(clone, 'config', k, v);
  git(clone, 'checkout', '-q', '-b', 'claude/lavoro');
  scrivi(clone, 'z-ultimo.txt', 'testo\n    \n\t\n   ');
  scrivi(clone, 'crlf.txt', 'riga\r\naltra\r\n');
  commit(clone, 'spazi in coda');
  const r = d.diffForBranch('claude/lavoro', clone);
  const vero = gitGrezzo(clone, 'diff', `${r.base.sha}...${r.head}`);
  const ctx = d.serverCtx({ role: 'secaudit', branch: 'claude/lavoro' }, null, r);
  const { s } = stampa(() => d.emit({ role: 'secaudit', branch: 'claude/lavoro', id: 'idfinto', num: '999' }, ctx));
  const p = JSON.parse(s).payload;
  expect(readFileSync(p.diffFile, 'utf8')).toBe(vero);
  expect(p.diffCaratteri).toBe(vero.length);
});

function repoConRebase(dir) {
  repoNuovo(dir);
  scrivi(dir, 'a.txt', 'base\n'); commit(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'claude/lavoro');
  scrivi(dir, 'a.txt', 'dal ramo\n'); commit(dir, 'ramo');
  git(dir, 'checkout', '-q', 'main');
  scrivi(dir, 'a.txt', 'da main\n'); commit(dir, 'main');
  git(dir, 'checkout', '-q', 'claude/lavoro');
}
function guardia(dir) {
  return spawnSync(BASH, [GUARDIA], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: '{}' });
}
function attesoDiFinire(g) {
  expect(g.status).toBe(0);
  expect(g.stderr).not.toContain('FERMATI');
  const msg = JSON.parse(g.stdout).hookSpecificOutput.additionalContext;
  expect(msg).toMatch(/rebase/i);
  expect(msg).toMatch(/--continue/);
}

test('guardia in un worktree collegato: il rebase del ramo assegnato si porta a termine, non FERMATI', async () => {
  const bi = await importa('scripts/lib/branch-integrity.mjs');
  const T = cartellaTemporanea('attriti-wt-');
  const principale = join(T, 'principale');
  mkdirSync(principale);
  repoConRebase(principale);
  git(principale, 'checkout', '-q', 'main');
  const wt = join(T, 'wt lavoro');
  git(principale, 'worktree', 'add', '-q', wt, 'claude/lavoro');
  bi.writeExpectation(wt, { branch: 'claude/lavoro', id: 'idfinto' });
  expect(spawnSync('git', ['rebase', 'main'], { cwd: wt }).status).not.toBe(0);
  attesoDiFinire(guardia(wt));
  const v = bi.checkDelivery(wt, 'claude/lavoro');
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/rebase in corso/);
});

test('guardia con pull --rebase e con un rebase fermo senza conflitto: stesso invito a finire', async () => {
  const bi = await importa('scripts/lib/branch-integrity.mjs');
  const T = cartellaTemporanea('attriti-pull-');
  const origine = join(T, 'origine');
  const clone = join(T, 'clone');
  mkdirSync(origine);
  repoNuovo(origine);
  scrivi(origine, 'a.txt', 'base\n'); commit(origine, 'base');
  git(T, 'clone', '-q', origine, clone);
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(clone, 'config', k, v);
  git(clone, 'checkout', '-q', '-b', 'claude/lavoro');
  scrivi(clone, 'a.txt', 'dal ramo\n'); commit(clone, 'ramo');
  scrivi(origine, 'a.txt', 'da main\n'); commit(origine, 'main avanza');
  bi.writeExpectation(clone, { branch: 'claude/lavoro', id: 'idfinto' });
  expect(spawnSync('git', ['pull', '--rebase', 'origin', 'main'], { cwd: clone }).status).not.toBe(0);
  attesoDiFinire(guardia(clone));
  git(clone, 'rebase', '--abort');

  expect(spawnSync('git', ['rebase', '-X', 'theirs', '-x', 'exit 1', 'origin/main'], { cwd: clone }).status).not.toBe(0);
  expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
  attesoDiFinire(guardia(clone));
  expect(bi.checkDelivery(clone, 'claude/lavoro').ok).toBe(false);
  git(clone, 'rebase', '--abort');

  // Una cartella staccata senza rebase resta una deriva.
  git(clone, 'checkout', '-q', '--detach');
  const g = guardia(clone);
  expect(g.status).toBe(2);
  expect(g.stderr).toContain('FERMATI');
});
