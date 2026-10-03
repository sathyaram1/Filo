// Verifica locale «unit-sulla-fusione», giro 2, rilievo 1: una prova degli unit sulla fusione interrotta a metà
// non deve lasciare una strada con cui i comandi di git svuotino node_modules. Qui node_modules è un canarino.
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const LIB = pathToFileURL(resolve(ROOT, 'scripts/lib/unit-sulla-fusione.mjs')).href;

test.setTimeout(180_000);

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitProva = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function uccidi(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* già morto */ } } }
}

test('prova interrotta, poi la pulizia che git stesso suggerisce sul worktree rimasto: node_modules resta intatto', async () => {
  const dir = cartellaTemporanea('fusione-interrotta-');
  const canarino = join(dir, 'canarino');
  mkdirSync(join(canarino, 'pacchetto'), { recursive: true });
  writeFileSync(join(canarino, 'pacchetto', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(join(canarino, 'radice.txt'), 'canarino\n');
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '--bare', origin);
  git(dir, 'clone', '-q', origin, repo);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(repo, 'config', k, v);
  mkdirSync(join(repo, 'scripts'));
  writeFileSync(join(repo, 'scripts', 'run-unit-tests.mjs'), 'setTimeout(() => process.exit(0), 120000);\n');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base'); git(repo, 'branch', '-M', 'main'); git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-qb', 'lavoro');
  writeFileSync(join(repo, 'b.txt'), 'lavoro\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'lavoro');
  git(repo, 'checkout', '-q', 'main');
  writeFileSync(join(repo, 'c.txt'), 'main\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'main avanza'); git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-q', 'lavoro');
  symlinkSync(canarino, join(repo, 'node_modules'), 'junction');

  const script = `const L = await import(${JSON.stringify(LIB)});
const punta = ${JSON.stringify(git(repo, 'rev-parse', 'HEAD'))};
L.provaUnitSullaFusione({ root: ${JSON.stringify(repo)}, punta, scrivi: () => {} });`;
  const figlio = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: repo, stdio: 'ignore', detached: process.platform !== 'win32' });
  let resto = '';
  const fine = Date.now() + 60_000;
  while (Date.now() < fine) {
    const l = git(repo, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((r) => r.startsWith('worktree ')).map((r) => r.slice(9));
    resto = l.find((p) => /filo-fusione-/.test(p)) || '';
    if (resto && existsSync(join(resto, 'node_modules'))) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  expect(resto, 'la prova non è partita').not.toBe('');
  await new Promise((r) => setTimeout(r, 1500));
  uccidi(figlio.pid);
  await new Promise((r) => setTimeout(r, 1500));

  try {
    // Il worktree rimasto è chiuso col lucchetto: git rifiuta il remove --force e suggerisce di togliere il
    // lucchetto prima. Chi pulisce fa quello che il messaggio di git dice.
    const primo = gitProva(repo, 'worktree', 'remove', '--force', resto);
    if (primo.status !== 0) {
      gitProva(repo, 'worktree', 'unlock', resto);
      gitProva(repo, 'worktree', 'remove', '--force', resto);
    }
    expect(readdirSync(canarino).sort()).toEqual(['pacchetto', 'radice.txt']);
    expect(existsSync(join(canarino, 'pacchetto', 'index.js'))).toBe(true);
  } finally {
    const L = await import(LIB);
    L.togliCollegamento(join(resto, 'node_modules'));
    L.pulisciResti({ git: L.gitIn(repo) });
    L.togliCollegamento(join(repo, 'node_modules'));
  }
});
