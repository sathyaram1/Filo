// Il rilascio dopo il giro del 14/09/2026 (scripts/routine-channel.mjs):
//   - il battito porta lo stato del contenitore (uptime, memoria, carico);
//   - `release` spinge il ramo corrente PRIMA di parlare col server, e se il
//     push fallisce non rilascia;
//   - il rapporto di fine sessione viaggia nel rilascio, con le due ritentate
//     che il server prevede (413 troppo grande, 400 malformato).
//
// Rete finta come in routineChannel.test.mjs (fetchImpl); per la riga di
// comando un server HTTP locale come in sealConsegna.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import('../../scripts/routine-channel.mjs');
const {
  heartbeat, release, releaseConRapporto, pushRamoCorrente, statoContenitore,
  memoriaContenitore, uptimeContenitore, rssProcessi, commitRestante,
} = mod;

const reply = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
const quiet = { sleep: async () => {} };

// ─── C. battito con stato del contenitore ────────────────────────────────────

test('il battito porta uptimeS, freeMb, rssMb, loadAvg: numeri, non stringhe', async () => {
  let sent = null;
  const fetchImpl = async (u, init) => { sent = JSON.parse(init.body); return reply(200, { ok: true, expiresAt: 'x' }); };
  const r = await heartbeat('tkt', { fetchImpl, ...quiet });
  assert.equal(r.ok, true);
  assert.equal(sent.ticket, 'tkt');
  for (const k of ['uptimeS', 'freeMb', 'rssMb', 'loadAvg']) {
    assert.equal(typeof sent[k], 'number', `${k} deve essere un numero`);
    assert.ok(Number.isFinite(sent[k]));
  }
  assert.ok(sent.rssMb > 0, 'un processo Node vivo occupa memoria');
});

test('stato del contenitore: un valore non numerico non parte (il server lo ignorerebbe comunque)', () => {
  const osImpl = { uptime: () => 12.6, freemem: () => 3 * 1048576, loadavg: () => [NaN, 0, 0] };
  const proc = { memoryUsage: () => ({ rss: 2 * 1048576 }) };
  assert.deepEqual(statoContenitore({ osImpl, proc }), { uptimeS: 13, freeMb: 3, rssMb: 2, loadAvg: 0 });
  const senzaCarico = statoContenitore({ osImpl: { ...osImpl, uptime: () => 'boh', loadavg: () => [0.5] }, proc });
  assert.equal(senzaCarico.uptimeS, undefined);
  assert.equal(senzaCarico.loadAvg, 0.5);
});

// ─── D. il rapporto nel rilascio ─────────────────────────────────────────────

const RAPPORTO = { v: 1, role: 'resolver', ticket: 't', tools: { total: 2, byName: { Bash: 2 }, timeouts: 0, errors: 0 }, notes: ['una nota'], costUsd: 1 };

test('release: il rapporto viaggia col nome `report`; senza rapporto non c\'è la chiave', async () => {
  const corpi = [];
  const fetchImpl = async (u, init) => { corpi.push(JSON.parse(init.body)); return reply(200, { ok: true }); };
  await release('t', '', { fetchImpl, ...quiet }, RAPPORTO);
  await release('t', '', { fetchImpl, ...quiet });
  assert.deepEqual(corpi[0].report, RAPPORTO);
  assert.equal('report' in corpi[1], false);
});

test('413 report_too_big: si ritenta una volta senza tools.byName e notes', async () => {
  const corpi = [];
  const fetchImpl = async (u, init) => {
    const b = JSON.parse(init.body); corpi.push(b);
    return b.report && b.report.tools && b.report.tools.byName
      ? reply(413, { ok: false, reason: 'report_too_big', bytes: 9000, max: 8000 })
      : reply(200, { ok: true });
  };
  const r = await releaseConRapporto('t', '', RAPPORTO, { fetchImpl, ...quiet });
  assert.equal(r.ok, true);
  assert.equal(r.rapporto, 'ridotto');
  assert.equal(corpi.length, 2);
  assert.equal('byName' in corpi[1].report.tools, false);
  assert.equal('notes' in corpi[1].report, false);
  assert.equal(corpi[1].report.tools.total, 2, 'il resto del rapporto resta');
  assert.match(r.avviso, /9000.*8000/);
  assert.deepEqual(RAPPORTO.tools.byName, { Bash: 2 }, 'l\'originale non viene mutilato');
});

test('413 anche ridotto: si rilascia senza rapporto, e lo si dice', async () => {
  const corpi = [];
  const fetchImpl = async (u, init) => {
    const b = JSON.parse(init.body); corpi.push(b);
    return b.report ? reply(413, { ok: false, reason: 'report_too_big', bytes: 9, max: 1 }) : reply(200, { ok: true });
  };
  const r = await releaseConRapporto('t', 'guasto x', RAPPORTO, { fetchImpl, ...quiet });
  assert.equal(r.ok, true);
  assert.equal(r.rapporto, 'scartato');
  assert.equal(corpi.length, 3);
  assert.equal('report' in corpi[2], false);
  assert.equal(corpi[2].fault, 'guasto x', 'il guasto dichiarato resta anche nella ritentata');
  assert.match(r.avviso, /SENZA rapporto/);
});

test('400 report_malformed: si rilascia senza rapporto, e lo si dice', async () => {
  const corpi = [];
  const fetchImpl = async (u, init) => {
    const b = JSON.parse(init.body); corpi.push(b);
    return b.report ? reply(400, { ok: false, reason: 'report_malformed' }) : reply(200, { ok: true });
  };
  const r = await releaseConRapporto('t', '', RAPPORTO, { fetchImpl, ...quiet });
  assert.equal(r.ok, true);
  assert.equal(r.rapporto, 'scartato');
  assert.equal(corpi.length, 2);
  assert.match(r.avviso, /report_malformed/);
});

test('un altro rifiuto del server NON viene ritentato senza rapporto: il no è una risposta', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return reply(401, { ok: false, reason: 'dead_ticket' }); };
  const r = await releaseConRapporto('t', '', RAPPORTO, { fetchImpl, ...quiet });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'dead_ticket');
  assert.equal(n, 1);
});

// ─── B. il push prima del rilascio ───────────────────────────────────────────

const made = [];
function g(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function commitFile(cwd, name) {
  writeFileSync(resolve(cwd, name), `${name}\n`, 'utf8');
  g(cwd, ['add', '-A']);
  g(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', name]);
}
/** Repo di lavoro con un finto origin già popolato di `main`. */
function scena() {
  const base = cartellaTemporanea('filo-release-push-');
  made.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  g(work, ['init', '-q', '--initial-branch=main']);
  g(work, ['remote', 'add', 'origin', origin]);
  commitFile(work, 'base.txt');
  g(work, ['push', '-q', 'origin', 'main']);
  g(work, ['remote', 'set-head', 'origin', 'main']);
  return { base, origin, work };
}
const remoteSha = (origin, ramo) => (g(origin, ['rev-parse', '--verify', '-q', `refs/heads/${ramo}`]) || '');
test.after(() => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

describe('pushRamoCorrente', () => {
  test('un ramo mai spedito arriva su origin; uno riscritto da un rebase pure (--force-with-lease)', () => {
    const { origin, work } = scena();
    g(work, ['checkout', '-q', '-b', 'worker/7']);
    commitFile(work, 'a.js');
    const primo = pushRamoCorrente(work);
    assert.deepEqual(primo, { ok: true, skipped: false, branch: 'worker/7' });
    assert.equal(remoteSha(origin, 'worker/7'), g(work, ['rev-parse', 'HEAD']));
    // Rebase: A sparisce, al suo posto C. Origin ha A.
    g(work, ['reset', '-q', '--hard', 'HEAD~1']);
    commitFile(work, 'c.js');
    const secondo = pushRamoCorrente(work);
    assert.equal(secondo.ok, true);
    assert.equal(secondo.forced, true);
    assert.equal(remoteSha(origin, 'worker/7'), g(work, ['rev-parse', 'HEAD']),
      'il commit finale del worker deve essere su origin: il contenitore muore dopo il rilascio');
  });

  test('qualcun altro ha spinto nel frattempo: il lease rifiuta e il push non riesce, con la causa', () => {
    const { base, origin, work } = scena();
    g(work, ['checkout', '-q', '-b', 'worker/8']);
    commitFile(work, 'a.js');
    assert.equal(pushRamoCorrente(work).ok, true);
    const altro = resolve(base, 'altro');
    g(base, ['clone', '-q', origin, altro]);
    g(altro, ['checkout', '-q', 'worker/8']);
    commitFile(altro, 'di-un-altro.js');
    g(altro, ['push', '-q', 'origin', 'worker/8']);
    const b = g(altro, ['rev-parse', 'HEAD']);
    g(work, ['reset', '-q', '--hard', 'HEAD~1']);
    commitFile(work, 'c.js');
    const r = pushRamoCorrente(work);
    assert.equal(r.ok, false);
    assert.match(r.reason, /force-with-lease/);
    assert.equal(remoteSha(origin, 'worker/8'), b, 'il lavoro dell\'altro resta');
  });

  test('HEAD staccata e ramo protetto: si salta (ok, skipped), niente parte', () => {
    const { origin, work } = scena();
    const prima = remoteSha(origin, 'main');
    commitFile(work, 'su-main.js');
    const suMain = pushRamoCorrente(work);
    assert.equal(suMain.ok, true); assert.equal(suMain.skipped, true); assert.match(suMain.reason, /protetto/);
    assert.equal(remoteSha(origin, 'main'), prima, 'main non si tocca da qui');
    g(work, ['checkout', '-q', '--detach', 'HEAD']);
    const staccata = pushRamoCorrente(work);
    assert.equal(staccata.ok, true); assert.equal(staccata.skipped, true); assert.match(staccata.reason, /staccata/);
  });

  test('origin irraggiungibile: ok falso con il motivo di git', () => {
    const { work } = scena();
    g(work, ['checkout', '-q', '-b', 'worker/9']);
    g(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    commitFile(work, 'a.js');
    const r = pushRamoCorrente(work);
    assert.equal(r.ok, false);
    assert.equal(r.branch, 'worker/9');
    assert.match(r.reason, /non-esiste|does not appear|repository/i);
  });
});

// ─── La riga di comando, tutta insieme ───────────────────────────────────────

function fintoServer(rispondi) {
  const ricevute = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = {}; try { json = JSON.parse(body); } catch (_) {}
      ricevute.push({ url: req.url, body: json });
      const { status, reply: r } = rispondi(req.url, json);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(r));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, ricevute })));
}
function cli(args, env) {
  return new Promise((done) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...args], { env: { ...process.env, ...env } },
      (err, so, se) => done({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

describe('release da riga di comando', () => {
  test('spinge il ramo, poi rilascia col rapporto allegato (rapporto minimo: qui non c\'è un transcript)', async () => {
    const { srv, port, ricevute } = await fintoServer(() => ({ status: 200, reply: { ok: true } }));
    const { base, origin, work } = scena();
    try {
      g(work, ['checkout', '-q', '-b', 'worker/10']);
      commitFile(work, 'lavoro.js');
      const r = await cli(['release', 'tkt-cli', '--role', 'resolver'], {
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_NO_BEAT: '1',
        CLAUDE_CONFIG_DIR: resolve(base, 'claude-vuoto'), FILO_TRANSCRIPT: '',
      });
      assert.equal(r.code, 0, `stderr: ${r.se}`);
      assert.match(r.so, /biglietto rilasciato/);
      assert.match(r.se, /spedito su origin/);
      assert.equal(remoteSha(origin, 'worker/10'), g(work, ['rev-parse', 'HEAD']));
      const rilascio = ricevute.find((x) => x.url.includes('routineRelease'));
      assert.ok(rilascio, 'il server ha ricevuto il rilascio');
      assert.equal(rilascio.body.ticket, 'tkt-cli');
      assert.equal(rilascio.body.report.v, 1);
      assert.equal(rilascio.body.report.role, 'resolver');
      assert.equal(rilascio.body.report.ticket, 'tkt-cli');
      assert.ok(Array.isArray(rilascio.body.report.notes) && rilascio.body.report.notes.length >= 1, 'senza transcript: la nota c\'è');
    } finally { srv.close(); }
  });

  test('push fallito: NON rilascia, esce diverso da zero e dice la causa', async () => {
    const { srv, port, ricevute } = await fintoServer(() => ({ status: 200, reply: { ok: true } }));
    const { work } = scena();
    try {
      g(work, ['checkout', '-q', '-b', 'worker/11']);
      g(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
      commitFile(work, 'lavoro.js');
      const r = await cli(['release', 'tkt-cli'], { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_NO_BEAT: '1' });
      assert.notEqual(r.code, 0);
      assert.match(r.se, /NON è arrivato su origin/);
      assert.match(r.se, /Non ho rilasciato niente/);
      assert.equal(ricevute.length, 0, 'il server non deve essere stato chiamato');
    } finally { srv.close(); }
  });

  test('--senza-push e --senza-rapporto: rilascio nudo, come prima', async () => {
    const { srv, port, ricevute } = await fintoServer(() => ({ status: 200, reply: { ok: true } }));
    const { work } = scena();
    try {
      g(work, ['checkout', '-q', '-b', 'worker/12']);
      g(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
      const r = await cli(['release', 'tkt-cli', '--senza-push', '--senza-rapporto', '--guasto', 'motivo'], {
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_NO_BEAT: '1',
      });
      assert.equal(r.code, 0, `stderr: ${r.se}`);
      const rilascio = ricevute.find((x) => x.url.includes('routineRelease'));
      assert.deepEqual(rilascio.body, { ticket: 'tkt-cli', fault: 'motivo' });
    } finally { srv.close(); }
  });
});
