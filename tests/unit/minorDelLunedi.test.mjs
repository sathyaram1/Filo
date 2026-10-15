// #1160 — La minor del lunedì (scripts/minor-del-lunedi.mjs, release.yml): la corsa giusta a mezzanotte di Roma con
// l'ora legale e con quella solare, il permesso del server prima di scegliere il commit, la minor anche sullo stesso
// commit dell'ultima patch, e niente minor se il server la rinvia (un feedback di sicurezza a priorità 3 aperto).
// Il server è finto: tutto offline.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const M = await import('../../scripts/minor-del-lunedi.mjs');
const { exitCodeForBump, messageForBump } = await import('../../scripts/release-bump.mjs');
const YML = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

describe('quando', () => {
  test('mezzanotte del lunedì a Roma, con l\'ora legale e con la solare', () => {
    // Ora legale fino al 25/10/2026: le 22 UTC della domenica sono già lunedì.
    assert.deepEqual(M.oraDiRoma(new Date('2026-10-18T22:00:00Z')), { giorno: 1, ora: 0, data: '2026-10-19' });
    assert.deepEqual(M.oraDiRoma(new Date('2026-10-18T23:00:00Z')), { giorno: 1, ora: 1, data: '2026-10-19' });
    // Ora solare: alle 22 UTC è ancora domenica, alle 23 è lunedì.
    assert.deepEqual(M.oraDiRoma(new Date('2026-11-01T22:00:00Z')), { giorno: 7, ora: 23, data: '2026-11-01' });
    assert.deepEqual(M.oraDiRoma(new Date('2026-11-01T23:00:00Z')), { giorno: 1, ora: 0, data: '2026-11-02' });
    assert.equal(M.nellaFinestra(new Date('2026-11-01T22:00:00Z')), false);
    assert.equal(M.nellaFinestra(new Date('2026-11-01T23:40:00Z')), true, 'una corsa in ritardo esce lo stesso');
    assert.equal(M.nellaFinestra(new Date('2026-11-02T05:30:00Z')), false, 'il lunedì alle 6:30 non è più la minor');
    assert.equal(M.nellaFinestra(new Date('2026-10-15T23:00:00Z')), false, 'un venerdì');
  });

  test('ogni domenica di due anni almeno una delle due corse cade nella finestra, compresi i cambi d\'ora', () => {
    const orari = M.CRON_MINOR.map((c) => Number(c.split(' ')[1]));
    for (let t = Date.parse('2026-01-04T00:00:00Z'); t < Date.parse('2028-01-01T00:00:00Z'); t += 7 * 864e5) {
      const domenica = new Date(t).toISOString().slice(0, 10);
      const dentro = orari.filter((h) => M.nellaFinestra(new Date(`${domenica}T${String(h).padStart(2, '0')}:00:00Z`)));
      assert.ok(dentro.length >= 1, `domenica ${domenica}: nessuna corsa della minor cade nel lunedì di Roma`);
    }
  });

  test('le corse della minor in release.yml sono quelle che lo script riconosce', () => {
    const intestazione = YML.slice(0, YML.indexOf('jobs:'));
    const cron = [...intestazione.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map((m) => m[1]);
    for (const c of M.CRON_MINOR) assert.ok(cron.includes(c), `release.yml non ha la corsa ${c}`);
    assert.ok(cron.includes('0 */6 * * *'), 'il canale veloce resta ogni sei ore');
    assert.equal(M.tipoDellaCorsa({ evento: 'schedule', cron: '0 */6 * * *' }), 'patch');
    assert.equal(M.tipoDellaCorsa({ evento: 'schedule', cron: '0 22 * * 0' }), 'minor-programmata');
    assert.equal(M.tipoDellaCorsa({ evento: 'workflow_dispatch', aMano: 'true' }), 'minor-a-mano');
    assert.equal(M.tipoDellaCorsa({ evento: 'workflow_dispatch', aMano: 'false' }), 'patch');
    assert.equal(M.tipoDellaCorsa({ evento: 'push', aMano: 'true' }), 'patch');
  });
});

describe('il permesso e il numero', () => {
  test('il server permette, rinvia o dà il numero: e un numero che non è una minor non si costruisce', () => {
    assert.deepEqual(M.classificaMinor(200, { ok: true, permessa: true }), { outcome: 'permessa' });
    assert.deepEqual(M.classificaMinor(200, { ok: true, permessa: false, motivo: 'settimana' }), { outcome: 'rinviata', motivo: 'settimana' });
    assert.deepEqual(M.classificaMinor(200, { ok: true, permessa: false, motivo: 'sicurezza' }), { outcome: 'rinviata', motivo: 'rinviata' });
    assert.equal(M.classificaMinor(200, { ok: true, version: '0.3.0', previous: '0.2.240' }).version, '0.3.0');
    for (const version of ['0.2.241', '0.3.1', 'v0.3.0', '', undefined]) {
      const r = M.classificaMinor(200, { ok: true, version });
      assert.equal(r.outcome, 'fault', String(version));
      assert.notEqual(exitCodeForBump(r), 0, `${version}: si costruirebbe una patch spacciata per minor`);
    }
    assert.equal(M.classificaMinor(409, { ok: false, reason: 'rinviata' }).outcome, 'rinviata');
    assert.equal(exitCodeForBump(M.classificaMinor(409, { ok: false })), 2);
    assert.equal(M.classificaMinor(404, {}).outcome, 'not_deployed');
    assert.equal(exitCodeForBump(M.classificaMinor(404, {})), 3);
    assert.equal(M.classificaMinor(0, {}).outcome, 'unreachable');
    assert.equal(M.classificaMinor(401, {}).outcome, 'denied');
  });

  test('nel registro pubblico della corsa un rinvio non nomina feedback né sicurezza', () => {
    for (const motivo of ['settimana', 'rinviata']) {
      const frase = `${M.fraseRinvio(motivo)} ${messageForBump({ outcome: 'rinviata', motivo })}`;
      assert.doesNotMatch(frase, /sicurezza|#\d|feedback/i, frase);
    }
  });

  test('la decisione della corsa', () => {
    const base = { tipo: 'minor-programmata', finestra: true, permesso: { outcome: 'permessa' }, verde: 'abc', tag: 'v0.2.240', verdeOk: true };
    assert.equal(M.decidiMinor(base).sha, 'abc');
    assert.equal(M.decidiMinor({ ...base, finestra: false }).sha, '');
    assert.equal(M.decidiMinor({ ...base, tipo: 'minor-a-mano', finestra: false }).sha, 'abc', 'a mano non c\'è finestra');
    const rinvio = M.decidiMinor({ ...base, permesso: { outcome: 'rinviata', motivo: 'rinviata' } });
    assert.equal(rinvio.sha, '');
    assert.equal(rinvio.rossa, false, 'una minor rinviata non è un guasto: niente corsa rossa e niente domande');
    assert.match(rinvio.righe.join('\n'), /monitoraggio/);
    assert.deepEqual([M.decidiMinor({ ...base, permesso: { outcome: 'not_deployed' } }).rossa, M.decidiMinor({ ...base, permesso: null }).rossa], [true, true]);
    assert.deepEqual([M.decidiMinor({ ...base, verde: '' }).sha, M.decidiMinor({ ...base, verde: '' }).rossa], ['', false]);
    assert.equal(M.decidiMinor({ ...base, verde: '', erroreApi: 'gh assente' }).rossa, true, 'corse illeggibili: la minor salta in silenzio');
    assert.equal(M.decidiMinor({ ...base, verdeOk: false }).rossa, true);
  });
});

// ─── gli script veri contro un server finto ─────────────────────────────────

function fintoServer(rispondi) {
  const richieste = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : {};
      richieste.push({ url: req.url, body: b });
      const [status, risposta] = rispondi(req.url, b);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, richieste, port: srv.address().port })));
}

function lancia(script, args, env, cwd = ROOT) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', ...env } });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => risolvi({ status, stdout, stderr }));
  });
}

describe('release-bump.mjs --minor', () => {
  const BUMP = join(ROOT, 'scripts', 'release-bump.mjs');
  const bump = (port, args) => lancia(BUMP, args, { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_BUILD_PASSPHRASE: 'prova' });

  test('chiede la minor a releaseMinor, con la sola credenziale, e stampa solo il numero', async () => {
    const { srv, richieste, port } = await fintoServer(() => [200, { ok: true, version: '0.3.0', previous: '0.2.240' }]);
    try {
      const r = await bump(port, ['--minor']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '0.3.0\n');
      assert.equal(richieste.length, 1);
      assert.ok(richieste[0].url.endsWith('/releaseMinor'));
      assert.deepEqual(Object.keys(richieste[0].body), ['passphrase']);
    } finally { srv.close(); }
  });

  test('un server che risponde con una patch: niente numero, uscita diversa da zero', async () => {
    const { srv, port } = await fintoServer(() => [200, { ok: true, version: '0.2.241' }]);
    try {
      const r = await bump(port, ['--minor']);
      assert.equal(r.status, 3);
      assert.equal(r.stdout, '');
    } finally { srv.close(); }
  });

  test('rinviata all\'ultimo momento: rifiuto, niente numero', async () => {
    const { srv, port } = await fintoServer(() => [409, { ok: false, reason: 'rinviata' }]);
    try {
      const r = await bump(port, ['--minor']);
      assert.equal(r.status, 2);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /niente minor/);
    } finally { srv.close(); }
  });

  test('senza --minor resta la patch di sempre', async () => {
    const { srv, richieste, port } = await fintoServer(() => [200, { ok: true, version: '0.2.241' }]);
    try {
      const r = await bump(port, []);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(richieste[0].url.endsWith('/releaseBump'));
    } finally { srv.close(); }
  });
});

describe('ultima-suite-verde.mjs nella corsa della minor', () => {
  const SCRIPT = join(ROOT, 'scripts', 'ultima-suite-verde.mjs');

  // Il `gh` finto: una corsa verde della suite (con gli unit su Windows) sul commit in FAKE_GH_VERDE.
  const CORPO_GH = `
const p = process.argv.find((a) => a.startsWith('repos/')) || '';
if (process.env.FAKE_GH_GUASTO) { process.stderr.write('gh: non autenticato'); process.exit(1); }
if (p.includes('/actions/workflows/suite.yml/runs')) {
  process.stdout.write(JSON.stringify({ workflow_runs: [{ id: 7, head_sha: process.env.FAKE_GH_VERDE, conclusion: 'success',
    status: 'completed', event: 'push', head_branch: 'main', created_at: '2026-10-11T20:00:00Z', html_url: 'https://x/7' }] }));
} else if (/actions[/]runs[/]7[/]jobs/.test(p)) {
  process.stdout.write(JSON.stringify({ jobs: [{ name: 'unit-windows', conclusion: 'success' }] }));
} else if (p.includes('/releases/tags/')) process.stdout.write(JSON.stringify({ published_at: '2026-10-11T22:00:00Z' }));
else { process.stderr.write('percorso non previsto ' + p); process.exit(1); }
`;

  // Un main finto; senza `conGh` il `gh` finto non risponde e nessun verde si legge. Conta cosa chiede al server e cosa scrive.
  async function corsa({ env, risposta, conGh = false }) {
    const tmp = cartellaTemporanea('filo-minor-');
    const repo = join(tmp, 'main');
    const { srv, richieste, port } = await fintoServer(() => risposta);
    try {
      mkdirSync(repo, { recursive: true });
      const git = (args) => new Promise((ok, ko) => execFile('git', args, { cwd: repo }, (e, o) => (e ? ko(e) : ok(o))));
      await git(['init', '-q', '-b', 'main']);
      await git(['-c', 'user.email=p@f', '-c', 'user.name=p', 'commit', '-q', '--allow-empty', '-m', 'merge-gate: #1 via server']);
      // L'ultima patch è uscita proprio dal commit verde più nuovo.
      await git(['tag', 'v0.2.240']);
      const testa = (await git(['rev-parse', 'HEAD'])).trim();
      const bin = join(tmp, 'bin');
      mkdirSync(bin);
      if (process.platform === 'win32') {
        copyFileSync(process.execPath, join(bin, 'gh.exe'));
        writeFileSync(join(repo, 'api'), CORPO_GH);
      } else {
        writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${CORPO_GH}`);
        chmodSync(join(bin, 'gh'), 0o755);
      }
      writeFileSync(join(tmp, 'output.txt'), '');
      const r = await lancia(SCRIPT, [], {
        GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: join(tmp, 'output.txt'), GITHUB_STEP_SUMMARY: join(tmp, 'riassunto.md'),
        FILO_BUILD_PASSPHRASE: 'prova', FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FAKE_GH_VERDE: testa,
        PATH: `${bin}${delimiter}${process.env.PATH}`, ...(conGh ? {} : { FAKE_GH_GUASTO: '1' }), ...env,
      }, repo);
      return { ...r, testa, richieste, output: readFileSync(join(tmp, 'output.txt'), 'utf8'), riassunto: readFileSync(join(tmp, 'riassunto.md'), 'utf8') };
    } finally {
      srv.close();
      togliCartella(tmp, { tentativi: 10 });
    }
  }

  test('a mano, rinviata dal server: niente da pubblicare, la corsa resta verde, e il server è stato solo interrogato', async () => {
    const r = await corsa({
      env: { GITHUB_EVENT_NAME: 'workflow_dispatch', FILO_MINOR_A_MANO: 'true' },
      risposta: [200, { ok: true, permessa: false, motivo: 'rinviata' }],
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.output, 'sha=\ntipo=\n');
    assert.deepEqual(r.richieste.map((x) => [x.url, x.body]), [['/releaseMinor', { passphrase: 'prova', controllo: true }]]);
    assert.match(r.riassunto, /settimana prossima/);
  });

  test('permessa: la minor esce col commit verde più nuovo, anche se è lo stesso dell\'ultima patch', async () => {
    const r = await corsa({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', FILO_MINOR_A_MANO: 'true' }, risposta: [200, { ok: true, permessa: true }], conGh: true });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.output, `sha=${r.testa}\ntipo=minor\n`);
    assert.match(r.riassunto, /Si pubblica come minor/);
  });

  test('la stessa situazione nella corsa delle sei ore: niente di nuovo, niente patch', async () => {
    const r = await corsa({ env: { GITHUB_EVENT_NAME: 'schedule', FILO_CRON: '0 */6 * * *' }, risposta: [200, { ok: true }], conGh: true });
    assert.equal(r.output, 'sha=\n');
    assert.equal(r.richieste.length, 0);
  });

  test('una corsa programmata fuori dal lunedì non chiede niente a nessuno', async () => {
    const fuori = M.nellaFinestra() === false;
    const r = await corsa({ env: { GITHUB_EVENT_NAME: 'schedule', FILO_CRON: '0 22 * * 0' }, risposta: [200, { ok: true, permessa: true }] });
    if (fuori) {
      assert.equal(r.richieste.length, 0);
      assert.match(r.riassunto, /Fuori dalla finestra/);
      assert.equal(r.status, 0);
    }
    assert.match(r.output, /^sha=\n/);
  });

  test('permessa ma le corse della suite non si leggono: corsa rossa, niente pubblicato', async () => {
    const r = await corsa({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', FILO_MINOR_A_MANO: 'true' }, risposta: [200, { ok: true, permessa: true }] });
    assert.equal(r.status, 1);
    assert.equal(r.output, 'sha=\ntipo=\n');
    assert.match(r.riassunto, /non si sono lette/);
  });

  test('server senza la minor (non ancora pubblicata la funzione): corsa rossa, niente pubblicato', async () => {
    const r = await corsa({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', FILO_MINOR_A_MANO: 'true' }, risposta: [404, { error: 'Not Found' }] });
    assert.equal(r.status, 1);
    assert.equal(r.output, 'sha=\ntipo=\n');
  });
});

describe('release.yml porta la minor fino al numero', () => {
  const job = (nome) => {
    const i = YML.search(new RegExp(`^  ${nome}:`, 'm'));
    const resto = YML.slice(i + 1);
    const j = resto.search(/^  [a-z][\w-]*:/m);
    return YML.slice(i, j < 0 ? undefined : i + 1 + j);
  };

  test('scegli passa il tipo, e sa quale corsa è', () => {
    const s = job('scegli');
    assert.match(s, /tipo:\s*\$\{\{\s*steps\.scelta\.outputs\.tipo\s*\}\}/);
    assert.match(s, /FILO_CRON:\s*\$\{\{\s*github\.event\.schedule\s*\}\}/);
    assert.match(s, /FILO_MINOR_A_MANO:\s*\$\{\{\s*inputs\.minor\s*\}\}/);
    assert.match(YML.slice(0, YML.indexOf('jobs:')), /^\s{6}minor:\s*\n[\s\S]*?type:\s*boolean/m);
  });

  test('la minor si pubblica anche senza codice nuovo, e chiede al server una minor', () => {
    const r = job('release');
    const check = r.slice(r.indexOf('id: check'), r.indexOf('AHEAD=$('));
    assert.match(check, /needs\.scegli\.outputs\.tipo \}\}" = "minor"[\s\S]*?should_release=true/);
    assert.match(r, /node scripts\/release-bump\.mjs \$\{\{ needs\.scegli\.outputs\.tipo == 'minor' && '--minor' \|\| '' \}\}/);
  });
});
