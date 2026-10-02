// Prova del giro 1 (verifica locale di rilasci-fermi), rilievo 1: lo stesso fermo della pubblicazione, alla
// stessa versione, apre UN feedback solo, anche se il controllo quotidiano del server arriva prima del lavoro di
// pubblicazione e il lavoro trova poi un verde che non esce. Usa il codice vero del server (cartella filo-security
// accanto al repo); dove non c'è, la prova si salta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, '..', '..', '..');
const SCRIPT = join(RADICE, 'scripts', 'ultima-suite-verde.mjs');

function cartellaServer() {
  try {
    const comune = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: RADICE, encoding: 'utf8' }).trim();
    const dir = resolve(comune, '..', '..', 'filo-security', 'functions', 'src', 'routine');
    return existsSync(join(dir, 'buildAlarm.js')) && existsSync(join(dir, 'releaseWatch.js')) ? dir : '';
  } catch { return ''; }
}

const MOCK_GH = `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
const vero = cp.execFileSync;
cp.execFileSync = function (cmd, args, opts) {
  if (cmd !== 'gh') return vero.call(this, cmd, args, opts);
  const dati = JSON.parse(readFileSync(process.env.MOCK_GH, 'utf8'));
  const p = args[1];
  if (/workflows\\/suite\\.yml\\/runs/.test(p)) return JSON.stringify({ workflow_runs: dati.runs });
  if (/workflows\\/release\\.yml\\/runs/.test(p)) return JSON.stringify({ workflow_runs: [] });
  if (/releases\\/tags\\//.test(p)) return JSON.stringify(dati.release);
  throw new Error('percorso non finto: ' + p);
};
syncBuiltinESMExports();
`;

test('server prima, poi un verde che non esce: un solo feedback per il fermo alla stessa versione', async () => {
  const SEC = cartellaServer();
  test.skip(!SEC, 'manca il codice del server (filo-security) accanto al repo');
  test.fail(true, 'rilievo 1 del giro 1 aperto: il fermo dopo il verde non riconosce il fermo già aperto dal controllo del server');
  test.setTimeout(120_000);

  const require = createRequire(import.meta.url);
  const { runAlarm } = require(join(SEC, 'buildAlarm.js'));
  const { runReleaseWatch } = require(join(SEC, 'releaseWatch.js'));

  const aperti = [];
  const deps = {
    listOpen: async () => aperti,
    createFeedback: async (f) => { const d = { ...f, num: `#${aperti.length + 1}`, seq: aperti.length + 1 }; aperti.push(d); return { ok: true, num: d.num }; },
    log: { info() {}, warn() {}, error() {} },
  };
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await runAlarm(JSON.parse(b), deps))); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    const tmp = cartellaTemporanea('rilasci-fermi-r1-');
    const repo = join(tmp, 'repo');
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    g('config', 'user.email', 'prova@filo'); g('config', 'user.name', 'prova'); g('config', 'commit.gpgsign', 'false');
    const commit = (msg) => { writeFileSync(join(repo, 'f.txt'), `${msg}\n`); g('add', '-A'); g('commit', '-q', '-m', msg); };
    commit('base'); g('tag', 'v0.0.1');
    g('checkout', '-q', '-b', 'lavoro'); commit('lavoro'); g('checkout', '-q', 'main');
    g('merge', '-q', '--no-ff', '-m', 'finish: lavoro via server', 'lavoro');
    const verde = g('rev-parse', 'HEAD');

    const ORA = Date.now();
    const iso = (oreFa) => new Date(ORA - oreFa * 3.6e6).toISOString();

    // Il controllo quotidiano del server vede per primo la versione ferma da 60 ore.
    await runReleaseWatch({
      github: {
        latestRelease: async () => ({ ok: true, tag: 'v0.0.1', publishedAt: iso(60), url: '' }),
        commitsAfter: async () => ({ ok: true, aheadBy: 1, releaseCommits: 0 }),
        workflowRuns: async () => ({ ok: true, runs: [] }),
      },
      ...deps, nowMs: ORA,
    });
    expect(aperti.length).toBe(1);

    // Poi il lavoro di pubblicazione: c'è un verde da 20 ore che non è uscito.
    const mock = join(tmp, 'mock-gh.mjs'); writeFileSync(mock, MOCK_GH);
    const dati = join(tmp, 'gh.json');
    writeFileSync(dati, JSON.stringify({
      runs: [{ head_sha: verde, conclusion: 'success', status: 'completed', event: 'push', head_branch: 'main', created_at: iso(23), updated_at: iso(20), html_url: 'https://x/run' }],
      release: { published_at: iso(60) },
    }));
    const out = join(tmp, 'out.txt'); writeFileSync(out, '');
    const codice = await new Promise((ok) => {
      const c = spawn(process.execPath, ['--import', pathToFileURL(mock).href, SCRIPT], {
        cwd: repo,
        env: { ...process.env, MOCK_GH: dati, GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '', FILO_ROUTINE_API: `http://127.0.0.1:${server.address().port}`, FILO_BUILD_PASSPHRASE: 'finta' },
      });
      c.stdout.resume(); c.stderr.resume();
      c.on('close', ok);
    });
    expect(codice).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain(`sha=${verde}`);
    expect(aperti.map((d) => d.num)).toEqual(['#1']);
  } finally {
    server.close();
  }
});
