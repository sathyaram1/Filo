// Prove del giro 2 (verifica locale) sul lavoro «seguito del giro», punto 1:
// il bilancio dei 3 separato da quello dei 2, provato col comando `critica`
// com'è usato davvero (server finto per config/routines, repo temporaneo).

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readState } from '../../../scripts/verify-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-local.mjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Un repo su un ramo di lavoro, con una verifica già avviata e i bilanci del lavoro già consumati come chiesto. */
function repoConVerificaAvviata(counts) {
  const repo = join(cartellaTemporanea('giro2-bilancio3-'), 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  const sha = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, '.claude', 'verify-local.json'), JSON.stringify({
    'claude/prova': { request: 'la richiesta', requestedSha: sha, requestedAt: '2026-09-23T00:00:00.000Z', counts, derived: [], rounds: [] },
  }, null, 2));
  return repo;
}

async function serverFinto(caps) {
  const fields = {};
  for (const [k, v] of Object.entries(caps)) fields[k] = { integerValue: String(v) };
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fields }));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}/v1/projects/finto/databases/(default)/documents/config/routines`;
  return { url, chiudi: () => new Promise((ok) => srv.close(ok)) };
}

function critica(repo, url, testo) {
  const env = { ...process.env, FILO_REPO_ROOT: repo, FILO_ROUTINE_CONFIG_URL: url, FILO_ADMIN_ID_TOKEN: 'token-finto' };
  delete env.FILO_ADMIN_REFRESH_TOKEN;
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT, 'critica', testo], { cwd: repo, env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

const RIASSUNTO = 'Provato il salvataggio con titolo pieno, vuoto e lunghissimo, in tema chiaro e scuro: il resto funziona.\n';
const CAPS = { cap3: 5, cap2: 4, cap1: 1, cap0: 0 };

test.describe('bilancio dei 3 separato dal 2 — dal comando della verifica locale', () => {
  test.setTimeout(120_000);

  test('a bilancio dei 2 finito un 2 da solo non ferma: il lavoro passa e il 2 esce a parte, a priorità 2', async () => {
    const repo = repoConVerificaAvviata({ count2: 4 });
    const s = await serverFinto(CAPS);
    try {
      const r = await critica(repo, s.url, `${RIASSUNTO}[2i] il pulsante Salva non salva col titolo vuoto: apri, lascia vuoto, premi Salva.`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/verifica superata/);
      expect(r.stdout).toMatch(/Salva non salva/);
      expect(r.stdout).toMatch(/priorità 2/);
      expect(r.stdout).toMatch(/Il lavoro non si ferma/);
      const e = readState(repo)['claude/prova'];
      expect(e.verdict).toBe('pass');
      expect(e.derived.map((f) => [f.level, f.priority])).toEqual([[2, 2]]);
      expect(e.counts.count2).toBe(4);
    } finally { await s.chiudi(); }
  });

  test('a bilancio dei 3 finito un 3 ferma il lavoro, anche con giri dei 2 ancora da spendere', async () => {
    const repo = repoConVerificaAvviata({ count3: 5 });
    const s = await serverFinto(CAPS);
    try {
      const r = await critica(repo, s.url, `${RIASSUNTO}[3i] la cronologia di un altro utente si legge aprendo la pagina: basta la scheda nuova.`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/il lavoro si ferma/);
      expect(readState(repo)['claude/prova'].verdict).toBe('fail');
    } finally { await s.chiudi(); }
  });

  test('un 3 e un 2 insieme si correggono tutti e due e il giro lo paga il bilancio dei 3, anche a bilancio dei 2 finito', async () => {
    const repo = repoConVerificaAvviata({ count2: 4, count3: 1 });
    const s = await serverFinto(CAPS);
    try {
      const r = await critica(repo, s.url, `${RIASSUNTO}[3i] la cronologia di un altro utente si legge aprendo la pagina.\n[2i] il pulsante Salva non salva col titolo vuoto.`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/c'è da correggere/);
      const e = readState(repo)['claude/prova'];
      expect(e.verdict).toBe('fix-pending');
      expect(e.pending.findings.map((f) => f.level)).toEqual([3, 2]);
      expect(e.counts.count3).toBe(2);
      expect(e.counts.count2).toBe(4);
    } finally { await s.chiudi(); }
  });

  test('un 2 da solo con giri dei 2 ancora da spendere si corregge e paga il bilancio dei 2, non quello dei 3', async () => {
    const repo = repoConVerificaAvviata({ count2: 3 });
    const s = await serverFinto(CAPS);
    try {
      const r = await critica(repo, s.url, `${RIASSUNTO}[2i] il pulsante Salva non salva col titolo vuoto.`);
      expect(r.status, r.stderr).toBe(0);
      const e = readState(repo)['claude/prova'];
      expect(e.verdict).toBe('fix-pending');
      expect(e.counts.count2).toBe(4);
      expect(e.counts.count3 || 0).toBe(0);
    } finally { await s.chiudi(); }
  });
});
