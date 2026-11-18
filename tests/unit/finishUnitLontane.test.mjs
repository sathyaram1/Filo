// `npm run finish` vero sul PC dell'owner (#1497.3, D-185), in un repo usa-e-getta con origin e un GitHub finto: un
// file di prova arrivato da main e non toccato dal ramo non gira qui, l'esito lo dà la corsa su GitHub, e senza esito o
// con un esito rosso il finish si ferma. Le regole stanno in scripts/lib/unit-sul-pc.mjs e scripts/lib/prova-remota.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVONO = ['scripts', 'src/shared', 'src/main/auth', 'src/main/services/mergeApprovalSignal.js'];
const GITHUB = 'https://github.com/proprietario/filo.git';

function repoFinto({ conSpec = false } = {}) {
  const casa = cartellaTemporanea('filo-1497-');
  const segnoSpec = join(casa, 'spec-di-main-eseguito');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'lavoro');
  const senzaHook = join(casa, 'nessun-hook');
  const segno = join(casa, 'eseguito-da-main');
  mkdirSync(senzaHook);
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  const tracciati = execFileSync('git', ['ls-files', '-z', '--', ...SERVONO], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of tracciati) {
    mkdirSync(dirname(join(lavoro, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  const scrivi = (file, testo) => { mkdirSync(dirname(join(lavoro, file)), { recursive: true }); writeFileSync(join(lavoro, file), testo, 'utf8'); };
  scrivi('package.json', JSON.stringify({ name: 'finto', version: '0.0.1', private: true, scripts: { 'test:unit': 'node scripts/run-unit-tests.mjs' } }));
  scrivi('.gitignore', 'node_modules\n.claude\n');
  scrivi('tests/unit/base.test.mjs', "import { test } from 'node:test';\ntest('base', () => {});\n");
  if (conSpec) scrivi('src/pages/options/options.js', 'export const x = 1;\n');
  const git =(...a) => execFileSync('git', a, { cwd: lavoro, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '--initial-branch=main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', senzaHook]]) git('config', k, v);
  // origin dice GitHub, come sul PC dell'owner; git lo porta al deposito locale.
  git('config', `url.${origin}.insteadOf`, GITHUB);
  git('remote', 'add', 'origin', GITHUB);
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('push', '-q', 'origin', 'main');
  const commit = (msg) => { git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };

  // Un lavoro fidato porta su main una prova nuova; il ramo dell'owner nasce dopo e cambia solo la sua.
  scrivi('tests/unit/da-main.test.mjs', "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\n"
    + `test('arrivata da main', () => writeFileSync(${JSON.stringify(segno)}, 'eseguita'));\n`);
  // #1737: e uno spec dell'area delle opzioni, che il ramo dell'owner tocca.
  if (conSpec) {
    scrivi('tests/options-da-main.spec.mjs', "import { test } from '@playwright/test';\nimport { writeFileSync } from 'node:fs';\n"
      + `test('arrivato da main', () => writeFileSync(${JSON.stringify(segnoSpec)}, 'eseguito'));\n`);
  }
  const main = commit('main: una prova nuova da un lavoro fidato');
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', '-b', 'claude/owner');
  scrivi('tests/unit/del-ramo.test.mjs', "import { test } from 'node:test';\ntest('del ramo', () => {});\n");
  if (conSpec) scrivi('src/pages/options/options.js', 'export const x = 2;\n');
  const punta = commit('il ramo dell\'owner');
  return { casa, lavoro, git, scrivi, segno, segnoSpec, main, punta };
}

/** Un GitHub finto: accende la corsa e risponde con `registro(coppia)` come registro del lavoro che unisce. */
async function githubFinto({ dispatch = 204, registro }) {
  const richieste = [];
  let corsa = '';
  let coppia = null;
  let chiesta = null;
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      richieste.push({ metodo: req.method, percorso: url.pathname, auth: req.headers.authorization || '', corpo });
      const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && url.pathname === '/repos/proprietario/filo/dispatches') {
        if (dispatch !== 204) return json(dispatch, { message: 'Not Found' });
        const j = JSON.parse(corpo);
        corsa = j.client_payload.corsa;
        coppia = { ramo: j.client_payload.ramo, main: j.client_payload.main };
        chiesta = j.client_payload;
        res.writeHead(204); return res.end();
      }
      if (url.pathname === '/repos/proprietario/filo/actions/workflows/unit-fusione.yml/runs') {
        return json(200, { workflow_runs: corsa ? [{ id: 11, display_title: `unit-fusione ${corsa}`, status: 'completed', conclusion: 'success', html_url: 'https://github.com/proprietario/filo/actions/runs/11' }] : [] });
      }
      if (url.pathname === '/repos/proprietario/filo/actions/runs/11/jobs') return json(200, { jobs: [{ id: 22, name: 'unit' }] });
      if (url.pathname === '/repos/proprietario/filo/actions/jobs/22/logs') { res.writeHead(200); return res.end(registro(coppia, chiesta)); }
      return json(404, { message: 'Not Found' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { base: `http://127.0.0.1:${server.address().port}`, richieste, chiudi: () => new Promise((ok) => server.close(ok)) };
}

const riga = (campo) => `2026-11-16T07:12:34.1234567Z FILO-UNIT-FUSIONE ${JSON.stringify(campo)}\n`;

/** Asincrono: il GitHub finto risponde da questo stesso processo. */
function finish(r, gh, ...argomenti) {
  const env = { ...process.env, FILO_ROUTINE_API: 'http://127.0.0.1:9', FILO_UNIT_LONTANE: '1', FILO_GITHUB_API: gh.base, GH_TOKEN: 'token-finto' };
  for (const k of Object.keys(env)) {
    if (k === 'NODE_TEST_CONTEXT' || k === 'INIT_CWD' || k === 'GITHUB_TOKEN' || /^npm_/i.test(k)) delete env[k];
  }
  for (const k of ['FILO_ADMIN_REFRESH_TOKEN', 'FILO_SA_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[k];
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join('scripts', 'finish-local.mjs'), ...argomenti], { cwd: r.lavoro, env, windowsHide: true });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.on('close', (status) => ok({ status, out }));
  });
}

test('finish sul PC dell\'owner: la prova arrivata da main non gira qui, l\'esito lo dà GitHub', async () => {
  const r = repoFinto();
  const gh = await githubFinto({ registro: (c) => `inizio\n${riga({ ...c, esito: 'verde', mainSha: c.main })}fine\n` });
  try {
    const c = await finish(r, gh, '--check');
    assert.equal(c.status, 0, c.out);
    assert.ok(!existsSync(r.segno), `la prova arrivata da main è girata sul PC:\n${c.out}`);
    assert.match(c.out, /ok \d+ - del ramo/, 'quella del ramo gira qui');
    assert.match(c.out, /Sul tuo PC giro solo gli unit che il ramo cambia \(1 di 3\)/);
    assert.match(c.out, /Unit su GitHub, sulla fusione con main [0-9a-f]{8}: verdi\. Proseguo\.[\s\S]*actions\/runs\/11/);
    assert.match(c.out, /Controlli passati/);
    const accese = gh.richieste.filter((q) => q.metodo === 'POST');
    assert.equal(accese.length, 1);
    const p = JSON.parse(accese[0].corpo);
    assert.equal(p.event_type, 'unit-fusione');
    assert.deepEqual([p.client_payload.ramo, p.client_payload.main, p.client_payload.windows], [r.punta, r.main, 'tutti']);
    assert.equal(accese[0].auth, 'Bearer token-finto');
    assert.equal(r.git('rev-parse', 'refs/remotes/origin/claude/owner'), r.punta, 'il ramo è su origin prima della corsa, che lo scarica da lì');
  } finally {
    await gh.chiudi();
    togliCartella(r.casa);
  }
});

test('finish sul PC dell\'owner: unit rossi su GitHub fermano, e non si rifanno qui', async () => {
  const r = repoFinto();
  const gh = await githubFinto({ registro: (c) => riga({ ...c, esito: 'rosso_sulla_fusione', mainSha: c.main, rossi: ['tests/unit/da-main.test.mjs › arrivata da main'] }) });
  try {
    const c = await finish(r, gh, '--check');
    assert.equal(c.status, 1, c.out);
    assert.ok(!existsSync(r.segno), c.out);
    assert.match(c.out, /✖ tests\/unit\/da-main\.test\.mjs › arrivata da main[\s\S]*✗ Unit rossi su GitHub: non pubblico/);
    assert.doesNotMatch(c.out, /Controlli passati|Unit sul risultato della fusione/);
  } finally {
    await gh.chiudi();
    togliCartella(r.casa);
  }
});

test('finish sul PC dell\'owner: senza l\'esito di GitHub si ferma, senza ripiegare sul PC', async () => {
  for (const [come, gh] of [
    ['corsa finita senza la riga', await githubFinto({ registro: () => 'npm ci fallito\n' })],
    ['corsa che parla di un\'altra coppia', await githubFinto({ registro: (c) => riga({ ...c, main: 'f'.repeat(40), esito: 'verde' }) })],
    ['GitHub che non accende la corsa', await githubFinto({ dispatch: 404, registro: () => '' })],
  ]) {
    const r = repoFinto();
    try {
      const c = await finish(r, gh, '--check');
      assert.equal(c.status, 1, `${come}:\n${c.out}`);
      assert.match(c.out, /Gli unit arrivati da main non sono provati: GitHub non ha dato l'esito[\s\S]*Sul tuo PC non li eseguo al posto suo/, come);
      assert.ok(!existsSync(r.segno), `${come}: la prova di main è girata sul PC\n${c.out}`);
      assert.doesNotMatch(c.out, /Controlli passati|Unit sul risultato della fusione/, come);
    } finally {
      await gh.chiudi();
      togliCartella(r.casa);
    }
  }
});

test('finish sul PC dell\'owner, fino alla richiesta: la prova di GitHub vale anche per il server, e non si rifà', async () => {
  const r = repoFinto();
  r.scrivi('.claude/verify-local.json', JSON.stringify({ 'claude/owner': { verdict: 'pass', sha: r.punta, feedbackId: 'finto', feedbackNum: 1497 } }));
  const gh = await githubFinto({ registro: (c) => riga({ ...c, esito: 'verde', mainSha: c.main }) });
  try {
    const f = await finish(r, gh);
    assert.ok(!existsSync(r.segno), f.out);
    assert.match(f.out, /Unit sulla fusione: vale la prova fatta qui sopra[\s\S]*Chiedo al server di fondere/, f.out);
    assert.doesNotMatch(f.out, /Unit sul risultato della fusione con main/, 'la prova sulla fusione non gira sul PC');
    assert.equal(gh.richieste.filter((q) => q.metodo === 'POST').length, 1, 'una corsa sola');
  } finally {
    await gh.chiudi();
    togliCartella(r.casa);
  }
});

// #1737 giro 1: gli spec scelti per area sono prove anche loro.
const conSpec = (c, chiesta) => (chiesta && chiesta.spec ? { specChiesti: chiesta.spec.split(',').length, specProvati: chiesta.spec.split(',').length } : {});

test('finish sul PC dell\'owner: uno spec arrivato da main nell\'area che il ramo tocca non gira qui, lo prova GitHub', async () => {
  const r = repoFinto({ conSpec: true });
  let chiesta = null;
  const gh = await githubFinto({ registro: (c, q) => { chiesta = q; return riga({ ...c, esito: 'verde', mainSha: c.main, ...conSpec(c, q) }); } });
  try {
    const c = await finish(r, gh, '--check');
    assert.equal(c.status, 0, c.out);
    assert.ok(!existsSync(r.segnoSpec), `lo spec arrivato da main è girato sul PC:\n${c.out}`);
    assert.equal(chiesta && chiesta.spec, 'options-da-main', 'lo spec va nella corsa su GitHub');
    assert.match(c.out, /GitHub prova anche 1 spec delle aree toccate che il ramo non cambia/);
    assert.match(c.out, /Unit su GitHub \(con 1 spec delle aree toccate\), sulla fusione/);
  } finally {
    await gh.chiudi();
    togliCartella(r.casa);
  }
});

test('finish sul PC dell\'owner: una corsa che non dice di aver provato gli spec chiesti ferma', async () => {
  const r = repoFinto({ conSpec: true });
  const gh = await githubFinto({ registro: (c) => riga({ ...c, esito: 'verde', mainSha: c.main }) });
  try {
    const c = await finish(r, gh, '--check');
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /non ha provato i 1 spec delle aree toccate[\s\S]*Sul tuo PC non li eseguo al posto suo/);
    assert.ok(!existsSync(r.segnoSpec), c.out);
    assert.doesNotMatch(c.out, /Controlli passati/);
  } finally {
    await gh.chiudi();
    togliCartella(r.casa);
  }
});

test('main che si muove durante l\'attesa: sul PC dell\'owner la prova rifatta la chiede di nuovo a GitHub, con gli stessi spec', async () => {
  const { chiediLaFusione } = await import('../../scripts/finish-local.mjs');
  const r = repoFinto();
  const chieste = [];
  const gh = await githubFinto({ registro: (c, q) => { chieste.push(q); return riga({ ...c, esito: 'verde', mainSha: c.main, ...conSpec(c, q) }); } });
  const prima = { ...process.env };
  Object.assign(process.env, { FILO_UNIT_LONTANE: '1', FILO_GITHUB_API: gh.base, GH_TOKEN: 'token-finto' });
  const alServer = [];
  try {
    const giro = await chiediLaFusione({
      root: r.lavoro, branch: 'claude/owner', cur: r.punta, specRemoti: ['tests/options-x'],
      provaDelRamo: { prova: { esito: 'verde', mainSha: r.main }, punta: r.punta },
    }, {
      log: () => {},
      of: {},
      registraNelRegistro: async () => [],
      askServerMerge: async (q) => { alServer.push(q.provaUnit); return alServer.length === 1 ? { outcome: 'main_moved', mainSha: r.main } : { outcome: 'merged', sha: 'c'.repeat(40) }; },
    });
    assert.ok(!existsSync(r.segno), 'la prova rifatta è girata sul PC');
    assert.equal(chieste.length, 1, 'la seconda prova la fa GitHub');
    assert.equal(chieste[0].spec, 'options-x', 'con gli stessi spec della prima');
    assert.equal(alServer.length, 2);
    assert.equal(alServer[1].esito, 'verde');
    assert.equal(giro.reply.outcome, 'merged');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prima)) delete process.env[k];
    Object.assign(process.env, prima);
    await gh.chiudi();
    togliCartella(r.casa);
  }
});
