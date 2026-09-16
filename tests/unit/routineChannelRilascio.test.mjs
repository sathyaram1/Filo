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

// Fuori da un contenitore (niente /proc, niente cgroup: `leggi` risponde null).
const fuori = { leggi: () => null, elenca: () => [] };

test('stato del contenitore: un valore non numerico non parte (il server lo ignorerebbe comunque)', () => {
  const osImpl = { uptime: () => 12.6, freemem: () => 3 * 1048576, loadavg: () => [NaN, 0, 0] };
  const proc = { memoryUsage: () => ({ rss: 2 * 1048576 }) };
  assert.deepEqual(statoContenitore({ osImpl, proc, ...fuori }), { uptimeS: 13, freeMb: 3, rssMb: 2, loadAvg: 0 });
  const senzaCarico = statoContenitore({ osImpl: { ...osImpl, uptime: () => 'boh', loadavg: () => [0.5] }, proc, ...fuori });
  assert.equal(senzaCarico.uptimeS, undefined);
  assert.equal(senzaCarico.loadAvg, 0.5);
});

// Fino al 16/09/2026 rssMb era la memoria del processo che batte (piccola e
// costante) e uptime e memoria libera erano quelli del kernel, cioè della
// macchina ospite: un worker ucciso per il tetto del cgroup lasciava un
// battito con venti giga liberi (giro del 14/09, verifica).
test('in un contenitore le misure sono del contenitore: cgroup v2, età del processo 1, memoria usata dal cgroup', () => {
  const file = {
    '/sys/fs/cgroup/memory.current': '1610612736\n', // 1536 MB
    '/sys/fs/cgroup/memory.max': '4294967296\n', // 4096 MB
    // campo 22 (avvio del processo 1) = 5000 tick = 50 s dopo l'avvio del kernel
    '/proc/1/stat': '1 (init) S 0 1 1 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 5000 1000 100 18446744073709551615\n',
  };
  const leggi = (p) => (p in file ? file[p] : null);
  assert.deepEqual(memoriaContenitore(leggi), { usedMb: 1536, limitMb: 4096 });
  assert.equal(uptimeContenitore(3650, leggi), 3600);
  assert.equal(uptimeContenitore(3650, () => null), null);
  assert.equal(uptimeContenitore(10, leggi), null, 'un avvio nel futuro non è un uptime');
  const osImpl = { uptime: () => 3650, freemem: () => 99 * 1048576, loadavg: () => [0.5, 0, 0] };
  const proc = { memoryUsage: () => ({ rss: 2 * 1048576 }) };
  assert.deepEqual(statoContenitore({ osImpl, proc, leggi, elenca: () => [] }),
    { uptimeS: 3600, freeMb: 2560, rssMb: 1536, loadAvg: 0.5 },
    'uptime del contenitore, memoria che manca al tetto, memoria usata dal contenitore');
});

test('cgroup v1 senza tetto e, senza cgroup, la memoria è la somma di tutti i processi', () => {
  const v1 = {
    '/sys/fs/cgroup/memory/memory.usage_in_bytes': '104857600',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712',
  };
  const leggiV1 = (p) => (p in v1 ? v1[p] : null);
  assert.deepEqual(memoriaContenitore(leggiV1), { usedMb: 100, limitMb: 0 });
  assert.equal(memoriaContenitore(() => null), null);
  assert.equal(memoriaContenitore(() => 'boh'), null, 'un cgroup illeggibile non è un numero');
  // senza tetto: la memoria libera resta quella del kernel, l'usata è del cgroup
  const osImpl = { uptime: () => 10, freemem: () => 7 * 1048576, loadavg: () => [0] };
  const proc = { memoryUsage: () => ({ rss: 1048576 }) };
  assert.deepEqual(statoContenitore({ osImpl, proc, leggi: leggiV1, elenca: () => [] }), { uptimeS: 10, freeMb: 7, rssMb: 100, loadAvg: 0 });
  // Linux senza cgroup: la somma delle pagine residenti di tutti i processi (4 KB l'una)
  const statm = { '/proc/12/statm': '1000 256 10 1 0 100 0', '/proc/34/statm': '2000 768 10 1 0 100 0' };
  const leggiStatm = (p) => (p in statm ? statm[p] : null);
  const elenca = () => ['12', '34', 'self', 'meminfo'];
  assert.equal(rssProcessi(leggiStatm, elenca), 4);
  assert.equal(rssProcessi(() => null, () => []), null);
  assert.deepEqual(statoContenitore({ osImpl, proc, leggi: leggiStatm, elenca }), { uptimeS: 10, freeMb: 7, rssMb: 4, loadAvg: 0 });
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
    return b.report ? reply(400, { ok: false, reason: 'report_malformed', detail: 'campo x' }) : reply(200, { ok: true });
  };
  const r = await releaseConRapporto('t', '', RAPPORTO, { fetchImpl, ...quiet });
  assert.equal(r.ok, true);
  assert.equal(r.rapporto, 'scartato');
  assert.equal(corpi.length, 2);
  // Il dettaglio del server sta nella PRIMA risposta: fino al giro 2 della
  // verifica si leggeva la seconda (senza rapporto) e il dettaglio spariva.
  assert.match(r.avviso, /report_malformed: campo x/);
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

// L'hook committa solo su Edit/Write: un file nato da una shell al rilascio
// restava fuori dai commit, il rilascio spediva HEAD e diceva «spedito», e
// quel lavoro moriva col contenitore (giro del 14/09, verifica).
describe('commitRestante: quello che è rimasto fuori dai commit parte col rilascio', () => {
  test('un file nato da una shell viene committato (con la provenienza) e poi spedito', () => {
    const { origin, work } = scena();
    g(work, ['checkout', '-q', '-b', 'worker/20']);
    writeFileSync(resolve(work, 'nato-da-shell.txt'), 'x\n', 'utf8');
    const c = commitRestante(work, { env: { FILO_ROUTINE: '1' } });
    assert.equal(c.ok, true);
    assert.equal(c.skipped, false);
    assert.deepEqual(c.committed, ['nato-da-shell.txt']);
    assert.equal(g(work, ['status', '--porcelain']), '', 'niente resta fuori');
    assert.equal(g(work, ['log', '-1', '--format=%an <%ae>']), 'claude-routine <claude@routine>');
    assert.equal(g(work, ['log', '-1', '--format=%s']), 'auto: rilascio — nato-da-shell.txt');
    assert.equal(pushRamoCorrente(work).ok, true);
    assert.ok(g(origin, ['ls-tree', '--name-only', 'worker/20']).includes('nato-da-shell.txt'), 'il file è arrivato su origin');
    // in locale l'autore è quello locale
    writeFileSync(resolve(work, 'altro.txt'), 'y\n', 'utf8');
    assert.equal(commitRestante(work, { env: {} }).ok, true);
    assert.equal(g(work, ['log', '-1', '--format=%an']), 'claude-local');
  });

  test('directory pulita: niente commit; ramo protetto o HEAD staccata: si salta e si dice', () => {
    const { work } = scena();
    writeFileSync(resolve(work, 'su-main.txt'), 'x\n', 'utf8');
    const suMain = commitRestante(work);
    assert.deepEqual(suMain, { ok: true, skipped: true, committed: [], reason: "'main' è un ramo protetto: non committo" });
    assert.notEqual(g(work, ['status', '--porcelain']), '', 'sul ramo principale non si committa');
    g(work, ['checkout', '-q', '-b', 'worker/21']);
    g(work, ['add', '-A']);
    g(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'pulito']);
    assert.deepEqual(commitRestante(work), { ok: true, skipped: false, committed: [], reason: '' });
    g(work, ['checkout', '-q', '--detach']);
    writeFileSync(resolve(work, 'staccata.txt'), 'x\n', 'utf8');
    const staccata = commitRestante(work);
    assert.equal(staccata.skipped, true);
    assert.match(staccata.reason, /staccata/);
  });
});

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

  test('un file rimasto fuori dai commit viene committato e spedito prima del rilascio, e lo si dice', async () => {
    const { srv, port } = await fintoServer(() => ({ status: 200, reply: { ok: true } }));
    const { origin, work } = scena();
    try {
      g(work, ['checkout', '-q', '-b', 'worker/13']);
      writeFileSync(resolve(work, 'nato-da-shell.txt'), 'x\n', 'utf8');
      const r = await cli(['release', 'tkt-cli', '--senza-rapporto'], { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_NO_BEAT: '1' });
      assert.equal(r.code, 0, `stderr: ${r.se}`);
      assert.match(r.se, /committate 1 modifiche rimaste fuori dai commit: nato-da-shell\.txt/);
      assert.match(r.se, /spedito su origin/);
      assert.equal(g(work, ['status', '--porcelain']), '');
      assert.ok(g(origin, ['ls-tree', '--name-only', 'worker/13']).includes('nato-da-shell.txt'), 'il file è arrivato su origin col rilascio');
    } finally { srv.close(); }
  });
});

// ─── Giro 2 della verifica (16/09/2026): il lease dopo un fetch ─────────────
// --force-with-lease senza valore atteso si fida del ref remoto che la copia
// conosce: dopo un `git fetch` quel ref è già il commit dell'altro, il lease
// combacia e il rinvio lo sovrascrive. --force-if-includes lo rifiuta.
test('qualcun altro ha spinto E questa copia lo ha già scaricato con un fetch: il rinvio NON sovrascrive il suo commit', () => {
  const { base, origin, work } = scena();
  g(work, ['checkout', '-q', '-b', 'worker/9']);
  commitFile(work, 'a.js');
  assert.equal(pushRamoCorrente(work).ok, true);
  const altro = resolve(base, 'altro');
  g(base, ['clone', '-q', origin, altro]);
  g(altro, ['checkout', '-q', 'worker/9']);
  commitFile(altro, 'di-un-altro.js');
  g(altro, ['push', '-q', 'origin', 'worker/9']);
  const b = g(altro, ['rev-parse', 'HEAD']);
  g(work, ['fetch', '-q', 'origin']);
  g(work, ['reset', '-q', '--hard', 'HEAD~1']);
  commitFile(work, 'c.js');
  const r = pushRamoCorrente(work);
  assert.equal(r.ok, false, `il push doveva essere rifiutato: ${JSON.stringify(r)}`);
  assert.equal(remoteSha(origin, 'worker/9'), b, 'il commit dell\'altro resta su origin');
});

// ─── commitRestante nel mezzo di un conflitto ────────────────────────────────
//
// Stessa regola dell'hook (giro del 14/09, terza verifica): con un rebase o
// una fusione a metà, `git add -A` metterebbe in commit i segni di conflitto.
// Il rilascio si ferma e lo dice: chi lavora finisce l'operazione e rilancia.

describe('commitRestante: con un rebase o una fusione a metà non committa', () => {
  function repoInConflitto(nome) {
    const base = cartellaTemporanea(`filo-rilascio-conflitto-${nome}-`);
    const work = resolve(base, 'work');
    mkdirSync(work, { recursive: true });
    const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    g('init', '-q', '--initial-branch=main');
    writeFileSync(resolve(work, 'a.txt'), 'base\n');
    g('add', '-A'); g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'claude/prova');
    writeFileSync(resolve(work, 'a.txt'), 'mio\n');
    g('commit', '-q', '-am', 'mio');
    g('checkout', '-q', 'main');
    writeFileSync(resolve(work, 'a.txt'), 'loro\n');
    g('commit', '-q', '-am', 'loro');
    g('checkout', '-q', 'claude/prova');
    return { work, g };
  }

  test('fusione ferma su un conflitto: ok falso, col motivo, e HEAD non si muove', () => {
    const { work, g } = repoInConflitto('merge');
    assert.throws(() => g('merge', 'main'), 'la fusione deve fermarsi sul conflitto');
    const prima = g('rev-parse', 'HEAD');
    writeFileSync(resolve(work, 'nato-da-shell.txt'), 'x\n');
    const c = commitRestante(work);
    assert.equal(c.ok, false);
    assert.match(c.reason, /una fusione è a metà/);
    assert.equal(g('rev-parse', 'HEAD'), prima);
    assert.equal(mod.operazioneGitInCorso(work), 'una fusione');
  });

  test('rebase fermo su un conflitto: ok falso; a rebase finito si committa normalmente', () => {
    const { work, g } = repoInConflitto('rebase');
    assert.throws(() => g('rebase', 'main'), 'il rebase deve fermarsi sul conflitto');
    assert.equal(mod.operazioneGitInCorso(work), 'un rebase');
    const c = commitRestante(work);
    assert.equal(c.ok, false);
    assert.match(c.reason, /un rebase è a metà/);
    g('rebase', '--abort');
    assert.equal(mod.operazioneGitInCorso(work), '');
    writeFileSync(resolve(work, 'nato-da-shell.txt'), 'x\n');
    const dopo = commitRestante(work);
    assert.equal(dopo.ok, true);
    assert.deepEqual(dopo.committed, ['nato-da-shell.txt']);
  });
});

// ─── Giro 4 della verifica (16/09/2026): il no del server remoto ────────────
test('«[remote rejected]» (pre-receive, regola del repo, push protection): non è storia divergente, niente lease, il motivo del remoto nella causa', () => {
  const { origin, work } = scena();
  g(work, ['checkout', '-q', '-b', 'worker/10']);
  commitFile(work, 'a.js');
  assert.equal(pushRamoCorrente(work).ok, true);
  writeFileSync(resolve(origin, 'hooks', 'pre-receive'), '#!/bin/sh\nprintf "GH013: push declined due to repository rule violations\n" >&2\nexit 1\n', 'utf8');
  chmodSync(resolve(origin, 'hooks', 'pre-receive'), 0o755);
  commitFile(work, 'b.js');
  const r = pushRamoCorrente(work);
  assert.equal(r.ok, false);
  assert.equal(r.forced, undefined);
  assert.match(r.reason, /server remoto ha rifiutato/i, 'la diagnosi giusta: è il server a dire di no');
  assert.doesNotMatch(r.reason, /force-with-lease|qualcun altro ha spinto/i, 'non è storia divergente: un rebase non lo cura');
  assert.match(r.reason, /GH013/, 'col motivo del remoto');
  assert.notEqual(remoteSha(origin, 'worker/10'), g(work, ['rev-parse', 'HEAD']));
});
