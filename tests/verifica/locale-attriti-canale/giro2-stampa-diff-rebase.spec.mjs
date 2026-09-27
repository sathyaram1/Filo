// Prove del giro 2 (verifica locale) sugli attriti del canale: taglia della consegna per ogni ruolo, diff
// identico a git, guardia del ramo nei rebase che non sono il caso base (worktree, pull, stop senza conflitto).
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
const SOGLIA_STAMPA = 30000;

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
const lungo = (n, t = 'parola ') => t.repeat(Math.ceil(n / t.length)).slice(0, n);
const critica = (n) => 'Provato tutto.\n[2i] ' + lungo(n, 'rilievo "fra virgolette" \\ e a capo\n');
const fb = (n, extra = {}) => ({ text: lungo(n), images: [], documents: [], avviso: 'scritto da altri', ...extra });
const B = (role) => ({ role, branch: 'claude/x', id: 'idfinto', num: '999' });

const CASI = [
  ['verifier', 'feedback 2.000 e tre critiche da 2.500', { feedback: fb(2000), history: [2500, 2500, 2500].map((n) => ({ critique: critica(n) })) }],
  ['verifier', 'feedback 7.000', { feedback: fb(7000), history: [] }],
  ['verifier', 'sei decisioni', { feedback: fb(3000), decisioni: Array.from({ length: 6 }, () => ({ domanda: lungo(600), risposta: lungo(600) })) }],
  ['verifier', 'dieci critiche da 12.000 e feedback da 30.000', { feedback: fb(30000), history: Array.from({ length: 10 }, () => ({ critique: critica(12000) })) }],
  ['verifier', 'duecento critiche corte', { feedback: fb(500), history: Array.from({ length: 200 }, () => ({ critique: critica(300) })) }],
  ['verifier', 'feedback di emoji e markup', { feedback: fb(0, { text: '🙂'.repeat(10000) + '<script>x</script>' }) }],
  ['fixer', 'ripresa con critiche', { feedback: fb(8000), ripresa: { domanda: lungo(4000), risposta: lungo(4000) }, history: Array.from({ length: 4 }, () => ({ critique: critica(6000) })) }],
  ['new-work', 'feedback da 50.000 e quaranta immagini', { feedback: fb(50000, { images: Array.from({ length: 40 }, (_, i) => `https://esempio/${lungo(200)}${i}`) }) }],
];

test('la consegna di ogni ruolo sta sotto la soglia, il ruolo resta leggibile, i pezzi spostati sono interi', async () => {
  const d = await importa('scripts/dispatch.mjs');
  for (const [ruolo, nome, dalServer] of CASI) {
    const bucket = B(ruolo);
    const ctx = d.serverCtx(bucket, { payload: dalServer });
    const { s } = stampa(() => d.emit(bucket, ctx));
    const j = JSON.parse(s);
    expect(s.length, `${ruolo}: ${nome}`).toBeLessThan(SOGLIA_STAMPA);
    const ruoloIntero = d.readRoleInstructions(ruolo, { scope: ctx.scope, caso: j.payload.case }).replace(/\s+$/, '');
    expect(ruoloIntero.length, `${ruolo}: ${nome}`).toBeGreaterThan(1000);
    expect(j.instructions.startsWith(ruoloIntero), `${ruolo}: ${nome}`).toBe(true);
    for (const [campo, f] of Object.entries(j.payload.fileEsterni || {})) {
      const dentro = readFileSync(f, 'utf8');
      const originale = campo.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
      if (typeof originale === 'string') expect(dentro, `${ruolo}: ${nome}: ${campo}`).toBe(originale);
      else expect(JSON.parse(dentro), `${ruolo}: ${nome}: ${campo}`).toEqual(originale);
    }
  }
});

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
