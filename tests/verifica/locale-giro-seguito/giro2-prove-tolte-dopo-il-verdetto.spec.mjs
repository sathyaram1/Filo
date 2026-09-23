// Prove del giro 2 (verifica locale) sul lavoro «seguito del giro», punto 4:
// dopo un pass, togliere prove del giro (un file intero o un caso) non fa
// decadere il verdetto; aggiungere una riga sì. E la chiusura, con quel
// verdetto in mano, non rifà gli spec delle aree ma i controlli di logica sì.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { verdictForCurrentBranch } from '../../../scripts/verify-local.mjs';
import { specDaRilanciare } from '../../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-local.mjs');
const CARTELLA = 'tests/verifica/locale-prova';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const PROVA_A = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('il primo caso', () => {",
  '  expect(1 + 1).toBe(2);',
  '});',
  '',
  "test('il secondo caso, quello del rilievo messo da parte', () => {",
  '  expect(2 + 2).toBe(5);',
  '});',
  '',
].join('\n');
const PROVA_B = "import { test, expect } from '@playwright/test';\n\ntest('rilievo esterno', () => {\n  expect(true).toBe(false);\n});\n";

function repoConProve() {
  const repo = join(cartellaTemporanea('giro2-prove-tolte-'), 'repo');
  mkdirSync(join(repo, CARTELLA), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  writeFileSync(join(repo, 'a.txt'), 'prodotto\n');
  writeFileSync(join(repo, CARTELLA, 'giro1-a.spec.mjs'), PROVA_A);
  writeFileSync(join(repo, CARTELLA, 'giro1-b.spec.mjs'), PROVA_B);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'lavoro e prove del giro');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  const sha = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, '.claude', 'verify-local.json'), JSON.stringify({
    'claude/prova': { request: 'la richiesta', requestedSha: sha, requestedAt: '2026-09-23T00:00:00.000Z', counts: {}, derived: [], rounds: [] },
  }, null, 2));
  return repo;
}

async function serverFinto() {
  const fields = { cap3: { integerValue: '5' }, cap2: { integerValue: '4' }, cap1: { integerValue: '1' }, cap0: { integerValue: '0' } };
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ fields })); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}/v1/projects/finto/databases/(default)/documents/config/routines`, chiudi: () => new Promise((ok) => srv.close(ok)) };
}

function lancia(repo, url, ...args) {
  const env = { ...process.env, FILO_REPO_ROOT: repo, FILO_ROUTINE_CONFIG_URL: url, FILO_ADMIN_ID_TOKEN: 'token-finto' };
  delete env.FILO_ADMIN_REFRESH_TOKEN;
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: repo, env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

function commit(repo, msg) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', msg);
}

/** Repo con le prove, verifica superata sul commit delle prove. */
async function conPass(s) {
  const repo = repoConProve();
  const r = await lancia(repo, s.url, 'critica', 'Provato il lavoro dal lato di chi lo usa, con dati vuoti e lunghissimi: funziona, nessun rilievo.');
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/verifica superata/);
  return repo;
}

test.describe('prove del giro tolte dopo il verdetto — il pass regge, la chiusura non rifà gli spec', () => {
  test.setTimeout(120_000);

  test('un file intero tolto: il pass regge, e la chiusura salta gli spec delle aree (--check no)', async () => {
    const s = await serverFinto();
    try {
      const repo = await conPass(s);
      git(repo, 'rm', '-q', `${CARTELLA}/giro1-b.spec.mjs`);
      commit(repo, 'tolta la prova del rilievo esterno');
      const r = await lancia(repo, s.url, 'status');
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const v = verdictForCurrentBranch(repo);
      expect(v.ok).toBe(true);
      expect(specDaRilanciare({ checkOnly: false, ok: v.ok, sha: v.entry && v.entry.sha, tollerato: v.tollerato }).rilancia).toBe(false);
      expect(specDaRilanciare({ checkOnly: true, ok: v.ok, sha: v.entry && v.entry.sha, tollerato: v.tollerato }).rilancia).toBe(true);
    } finally { await s.chiudi(); }
  });

  test('un caso tolto da una prova che ne ha altri: il pass regge (come nel cancello di fusione del server)', async () => {
    const s = await serverFinto();
    try {
      const repo = await conPass(s);
      const p = join(repo, CARTELLA, 'giro1-a.spec.mjs');
      writeFileSync(p, readFileSync(p, 'utf8').split("test('il secondo caso")[0]);
      commit(repo, 'tolto il caso messo da parte');
      const r = await lancia(repo, s.url, 'status');
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(verdictForCurrentBranch(repo).ok).toBe(true);
    } finally { await s.chiudi(); }
  });

  test('una riga aggiunta nella cartella delle prove fa decadere il pass, e la chiusura rifà gli spec', async () => {
    const s = await serverFinto();
    try {
      const repo = await conPass(s);
      const p = join(repo, CARTELLA, 'giro1-a.spec.mjs');
      writeFileSync(p, readFileSync(p, 'utf8').replace('expect(1 + 1).toBe(2);', 'expect(1 + 1).toBe(2);
  expect(3).toBe(3);'));
      commit(repo, 'aggiunta una riga');
      const r = await lancia(repo, s.url, 'status');
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/cambiato dopo la verifica/);
      const v = verdictForCurrentBranch(repo);
      expect(v.ok).toBe(false);
      expect(specDaRilanciare({ checkOnly: false, ok: v.ok, sha: v.entry && v.entry.sha, tollerato: v.tollerato }).rilancia).toBe(true);
    } finally { await s.chiudi(); }
  });
});
