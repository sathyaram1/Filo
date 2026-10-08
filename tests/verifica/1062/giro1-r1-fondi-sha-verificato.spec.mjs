// #1062 giro 1, rilievo 1: server:fondi porta su main del server un commit che nessuno ha verificato.
// Due repo usa-e-getta affiancati (app e filo-security) e il vero tools/server-fondi.js del checkout del server accanto;
// la pratica passa da una rete finta. Il successo: dopo server:fondi, main del server non contiene il commit mai verificato.
import { test, expect } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const VERIFY = join(ROOT, 'scripts', 'verify-local.mjs');
const TOOLS_VERI = resolve(ROOT, '..', 'filo-security', 'functions', 'tools');
const RAMO = 'claude/prova';
const PASS = 'Provato il lavoro intero, app e server insieme, con inserimenti vuoti e lunghi: regge in ogni caso provato.';

const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (dir, file, testo) => { mkdirSync(resolve(dir, file, '..'), { recursive: true }); writeFileSync(resolve(dir, file), testo, 'utf8'); };
const commit = (dir, file, testo, msg) => { scrivi(dir, file, testo); g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); return g(dir, 'rev-parse', 'HEAD'); };
const identita = (dir) => { g(dir, 'config', 'user.email', 't@t'); g(dir, 'config', 'user.name', 't'); };
const dentro = (cwd, a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd }).status === 0;

let FINTO = '';
let fintoProc = null;
test.beforeAll(async () => {
  fintoProc = spawn(process.execPath, [join(ROOT, 'tests', 'helpers', 'finto-config-routines.mjs')], {
    env: { ...process.env, FINTO_CAPS: JSON.stringify({ cap3: 5, cap2: 5, cap1: 2, cap0: 0 }) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((ok) => { let so = ''; fintoProc.stdout.on('data', (c) => { so += c; const m = so.match(/PORT=(\d+)/); if (m) ok(Number(m[1])); }); });
  FINTO = `http://127.0.0.1:${port}/config/routines`;
});
test.afterAll(() => { try { fintoProc.kill(); } catch (_) { /* già morto */ } });

function vl(work, ...args) {
  const r = spawnSync(process.execPath, [VERIFY, ...args], {
    cwd: work, encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: work, FILO_ROUTINE_CONFIG_URL: FINTO, FILO_ADMIN_ID_TOKEN: 'finto' },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** App in un worktree come in locale, server col ramo omonimo spinto su origin e i suoi veri strumenti di fusione. */
function scenario() {
  const base = cartellaTemporanea('verifica-1062-');
  const main = resolve(base, 'Filo');
  const server = resolve(base, 'filo-security');
  const srvOrigin = resolve(base, 'srv-origin.git');
  mkdirSync(main);
  g(main, 'init', '-q', '-b', 'main'); identita(main);
  scrivi(main, '.gitignore', '.claude/\n');
  commit(main, 'app.txt', 'app\n', 'app');
  g(main, 'worktree', 'add', '-q', join('.claude', 'worktrees', 'prova'), '-b', RAMO);
  const work = resolve(main, '.claude', 'worktrees', 'prova');
  commit(work, 'lavoro.txt', 'lavoro\n', 'lavoro dell\'app');

  mkdirSync(srvOrigin); g(srvOrigin, 'init', '--bare', '-q', '--initial-branch=main');
  mkdirSync(server); g(server, 'init', '-q', '-b', 'main'); identita(server);
  g(server, 'remote', 'add', 'origin', srvOrigin);
  scrivi(server, '.gitignore', '.claude/\nnode_modules/\n');
  mkdirSync(join(server, 'functions', 'tools'), { recursive: true });
  for (const f of ['server-fondi.js', 'server-comune.js']) copyFileSync(join(TOOLS_VERI, f), join(server, 'functions', 'tools', f));
  scrivi(server, 'functions/package.json', JSON.stringify({ name: 'f', version: '1.0.0', scripts: { test: 'node -e 0' } }));
  scrivi(server, 'functions/package-lock.json', JSON.stringify({ name: 'f', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'f', version: '1.0.0' } } }));
  commit(server, 'functions/index.js', 'uno\n', 'server');
  g(server, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
  g(server, 'checkout', '-q', '-b', RAMO);
  const verificato = commit(server, 'functions/lavoro.js', 'v1\n', 'lavoro del server');
  g(server, 'push', '-q', '-u', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
  return { base, main, work, server, srvOrigin, verificato };
}

/** Un altro posto (un'altra sessione, un'altra macchina) che spinge sul ramo del server un commit mai verificato. */
function spintoDaFuori(sc) {
  const altro = resolve(sc.base, `altro-${Date.now()}`);
  execFileSync('git', ['clone', '-q', '--branch', RAMO, sc.srvOrigin, altro], { stdio: ['ignore', 'pipe', 'pipe'] });
  identita(altro);
  const sha = commit(altro, 'functions/lavoro.js', 'mai verificato\n', 'spinto da fuori');
  g(altro, 'push', '-q', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
  return sha;
}

function docPratica() {
  return {
    name: 'projects/x/databases/(default)/documents/feedback/p',
    fields: {
      seq: { integerValue: '910' }, clientId: { stringValue: 'local:claude' }, status: { stringValue: 'todo' },
      statusPublic: { stringValue: 'open' }, notes: { stringValue: '' }, senderProof: { stringValue: 'admin' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
    },
  };
}

/** server:fondi dal comando vero del repo; `primaDelServer` gira fra il controllo di Filo e il lancio dello strumento del server. */
async function fondi(sc, radice, primaDelServer = () => {}) {
  const { esegui } = await import(pathToFileURL(join(ROOT, 'scripts', 'server-fondi-pratica.mjs')).href);
  const { FIRESTORE_BASE } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'firestore-auth.mjs')).href);
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
    return String(url).includes('/feedback/p') ? new Response(JSON.stringify(docPratica()), { status: 200 }) : new Response('{}', { status: 404 });
  };
  const righe = [];
  try {
    const k = await esegui([RAMO, '--feedback', 'p'], {
      env: {}, radice, funzioni: join(sc.server, 'functions'), bearer: 'finto', base: FIRESTORE_BASE,
      log: (x) => righe.push(String(x)), err: (x) => righe.push(String(x)), ramiAperti: () => [],
      lancia: (cartella, args, env) => {
        primaDelServer();
        const r = spawnSync(process.execPath, [join('tools', 'server-fondi.js'), ...args], { cwd: cartella, encoding: 'utf8', env: { ...process.env, ...env } });
        righe.push(`${r.stdout || ''}${r.stderr || ''}`);
        return typeof r.status === 'number' ? r.status : 1;
      },
    });
    return { k, testo: righe.join('\n') };
  } finally { globalThis.fetch = vero; }
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('r1 un commit spinto sul ramo del server mentre server:fondi prepara la fusione non entra in main', async () => {
  test.skip(!existsSync(join(TOOLS_VERI, 'server-fondi.js')), 'manca il checkout di filo-security accanto al repo');
  const sc = scenario();
  expect(vl(sc.work, 'start', 'fai X su app e server').code).toBe(0);
  const c = vl(sc.work, 'critica', PASS);
  expect(c.out).toMatch(/verifica superata .* e il server claude\/prova/);
  let estraneo = '';
  const r = await fondi(sc, sc.work, () => { estraneo = spintoDaFuori(sc); });
  g(sc.server, 'fetch', '-q', 'origin');
  const mainServer = g(sc.server, 'rev-parse', 'refs/remotes/origin/main');
  expect(dentro(sc.server, estraneo, mainServer), `main del server ha preso il commit mai verificato (uscita ${r.k}):\n${r.testo}`).toBe(false);
});

test('r1 tolto il worktree del lavoro dell\'app, server:fondi non fonde un ramo del server mosso dopo il verdetto', async () => {
  test.skip(!existsSync(join(TOOLS_VERI, 'server-fondi.js')), 'manca il checkout di filo-security accanto al repo');
  const sc = scenario();
  expect(vl(sc.work, 'start', 'fai X su app e server').code).toBe(0);
  expect(vl(sc.work, 'critica', PASS).out).toMatch(/verifica superata .* e il server claude\/prova/);
  g(sc.main, 'worktree', 'remove', '--force', sc.work);
  const estraneo = spintoDaFuori(sc);
  const r = await fondi(sc, sc.main);
  g(sc.server, 'fetch', '-q', 'origin');
  const mainServer = g(sc.server, 'rev-parse', 'refs/remotes/origin/main');
  expect(dentro(sc.server, estraneo, mainServer), `main del server ha preso il commit mai verificato (uscita ${r.k}):\n${r.testo}`).toBe(false);
});
