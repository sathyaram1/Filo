// Verifica #1737 giro 1, rilievo 1: sul PC dell'owner il finish non deve eseguire prove arrivate da main che il suo
// ramo non tocca (D-185). Repo usa-e-getta con origin locale e GitHub finto che risponde verde.

import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVONO = ['scripts', 'src/shared', 'src/main/auth', 'src/main/services/mergeApprovalSignal.js'];
const GITHUB = 'https://github.com/proprietario/filo.git';

function repoFinto() {
  const casa = cartellaTemporanea('filo-1737-');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'lavoro');
  const senzaHook = join(casa, 'nessun-hook');
  const segno = join(casa, 'spec-di-main-eseguito');
  mkdirSync(senzaHook);
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  const tracciati = execFileSync('git', ['ls-files', '-z', '--', ...SERVONO], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of tracciati) {
    mkdirSync(dirname(join(lavoro, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  symlinkSync(join(ROOT, 'node_modules'), join(lavoro, 'node_modules'), 'junction');
  const scrivi = (file, testo) => { mkdirSync(dirname(join(lavoro, file)), { recursive: true }); writeFileSync(join(lavoro, file), testo, 'utf8'); };
  scrivi('package.json', JSON.stringify({ name: 'finto', version: '0.0.1', private: true, scripts: { 'test:unit': 'node scripts/run-unit-tests.mjs' } }));
  scrivi('.gitignore', 'node_modules\n.claude\n');
  scrivi('tests/unit/base.test.mjs', "import { test } from 'node:test';\ntest('base', () => {});\n");
  scrivi('src/pages/options/options.js', 'export const x = 1;\n');
  const git = (...a) => execFileSync('git', a, { cwd: lavoro, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '--initial-branch=main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', senzaHook]]) git('config', k, v);
  git('config', `url.${origin}.insteadOf`, GITHUB);
  git('remote', 'add', 'origin', GITHUB);
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('push', '-q', 'origin', 'main');
  const commit = (msg) => { git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };

  // Un lavoro fidato porta su main uno spec nuovo dell'area delle opzioni; il ramo dell'owner nasce dopo e tocca le opzioni.
  scrivi('tests/options-da-main.spec.mjs', "import { test } from '@playwright/test';\nimport { writeFileSync } from 'node:fs';\n"
    + `test('arrivato da main', () => writeFileSync(${JSON.stringify(segno)}, 'eseguito'));\n`);
  commit('main: uno spec nuovo da un lavoro fidato');
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', '-b', 'claude/owner');
  scrivi('src/pages/options/options.js', 'export const x = 2;\n');
  commit('il ramo dell\'owner tocca le opzioni');
  return { casa, lavoro, segno };
}

async function githubVerde() {
  let corsa = '';
  let coppia = null;
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && url.pathname === '/repos/proprietario/filo/dispatches') {
        const j = JSON.parse(corpo);
        corsa = j.client_payload.corsa;
        coppia = { ramo: j.client_payload.ramo, main: j.client_payload.main };
        res.writeHead(204); return res.end();
      }
      if (url.pathname === '/repos/proprietario/filo/actions/workflows/unit-fusione.yml/runs') {
        return json(200, { workflow_runs: corsa ? [{ id: 11, display_title: `unit-fusione ${corsa}`, status: 'completed', conclusion: 'success', html_url: 'https://github.com/x' }] : [] });
      }
      if (url.pathname === '/repos/proprietario/filo/actions/runs/11/jobs') return json(200, { jobs: [{ id: 22, name: 'unit' }] });
      if (url.pathname === '/repos/proprietario/filo/actions/jobs/22/logs') {
        res.writeHead(200);
        return res.end(`FILO-UNIT-FUSIONE ${JSON.stringify({ ...coppia, esito: 'verde', mainSha: coppia && coppia.main })}\n`);
      }
      return json(404, { message: 'Not Found' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { base: `http://127.0.0.1:${server.address().port}`, chiudi: () => new Promise((ok) => server.close(ok)) };
}

function finishCheck(r, gh) {
  const env = { ...process.env, FILO_ROUTINE_API: 'http://127.0.0.1:9', FILO_UNIT_LONTANE: '1', FILO_GITHUB_API: gh.base, GH_TOKEN: 'token-finto' };
  for (const k of Object.keys(env)) {
    if (k === 'INIT_CWD' || k === 'GITHUB_TOKEN' || k === 'TEST_WORKER_INDEX' || k === 'TEST_PARALLEL_INDEX' || /^npm_|^PW_|^PLAYWRIGHT_/i.test(k)) delete env[k];
  }
  for (const k of ['FILO_ADMIN_REFRESH_TOKEN', 'FILO_SA_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[k];
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join('scripts', 'finish-local.mjs'), '--check'], { cwd: r.lavoro, env, windowsHide: true });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.on('close', (status) => ok({ status, out }));
  });
}

test('sul PC dell\'owner uno spec arrivato da main, dell\'area che il ramo tocca, non gira sul PC', async () => {
  test.setTimeout(10 * 60 * 1000);
  const r = repoFinto();
  const gh = await githubVerde();
  try {
    const c = await finishCheck(r, gh);
    expect(c.out, 'il finish deve arrivare a scegliere gli spec delle aree').toMatch(/Durata prevista/);
    expect(existsSync(r.segno), `lo spec arrivato da main è girato sul PC dell'owner:\n${c.out}`).toBe(false);
  } finally {
    await gh.chiudi();
    togliCartella(r.casa);
  }
});
