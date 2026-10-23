// Chi lavora ancora nella cartella non perde né biglietto né cartella (#1480): riportare la cartella su main,
// posizionare un ramo e rilasciare il biglietto si rifiutano con l'uscita 5 e dicono chi è vivo (D-90, D-91).

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aspettaChe } from '../helpers/attese.mjs';
import {
  segniDiLavoroVivo, questoProcesso, comandoLeggibile, testoLavoroVivo, lavoroVivo, sottoCartella, timbroFile,
  TIMBRO_VIVO_MS, USCITA_LAVORO_VIVO, prepareBranch, writeExpectation,
} from '../../scripts/lib/branch-integrity.mjs';
import { beatFile } from '../../scripts/lib/routine-beat.mjs';
import { ticketFile } from '../../scripts/lib/routine-ticket.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISPATCH = join(REPO, 'scripts', 'dispatch.mjs');
const CANALE = join(REPO, 'scripts', 'routine-channel.mjs');
const ADESSO = Date.parse('2026-10-20T06:40:00Z');
const T1 = 'A'.repeat(43);
const T2 = 'B'.repeat(43);
const LINUX = process.platform === 'linux';

// ─── La decisione, da dati già letti ──────────────────────────────────────────

test('battito vivo di un altro biglietto: lavoro vivo; il proprio, o uno spento, no', () => {
  const battito = { pid: 635, ticket: T1, since: new Date(ADESSO).toISOString() };
  const segni = segniDiLavoroVivo({ battito, battitoVivo: true, adesso: ADESSO, processi: [] });
  assert.deepEqual(segni, [{ tipo: 'battito', biglietto: T1.slice(0, 8), pid: 635 }]);
  assert.deepEqual(segniDiLavoroVivo({ mio: T1, battito, battitoVivo: true, adesso: ADESSO }), []);
  assert.deepEqual(segniDiLavoroVivo({ battito, battitoVivo: false, adesso: ADESSO }), []);
});

test('timbro del salvataggio: fresco e dopo la fine del biglietto vale; prima della fine, vecchio o mio no', () => {
  const biglietto = { ticket: T1, since: new Date(ADESSO - 3600000).toISOString() };
  const dueMinutiFa = ADESSO - 2 * 60000;
  assert.equal(segniDiLavoroVivo({ biglietto, timbroMs: dueMinutiFa, adesso: ADESSO })[0].tipo, 'timbro');
  assert.deepEqual(segniDiLavoroVivo({ biglietto, timbroMs: ADESSO - TIMBRO_VIVO_MS - 1000, adesso: ADESSO }), []);
  assert.deepEqual(segniDiLavoroVivo({ mio: T1, biglietto, timbroMs: dueMinutiFa, adesso: ADESSO }), []);
  const rilasciato = { ...biglietto, morto: { ora: new Date(ADESSO - 60000).toISOString(), perche: 'rilasciato' } };
  assert.deepEqual(segniDiLavoroVivo({ biglietto: rilasciato, timbroMs: dueMinutiFa, adesso: ADESSO }), [], 'ultimo salvataggio prima del rilascio');
  const zombie = { ...biglietto, morto: { ora: new Date(ADESSO - 5 * 60000).toISOString(), perche: 'rilasciato' } };
  assert.equal(segniDiLavoroVivo({ biglietto: zombie, timbroMs: dueMinutiFa, adesso: ADESSO }).length, 1, 'salvato DOPO il rilascio: il worker lavora ancora (D-90)');
  assert.deepEqual(segniDiLavoroVivo({ biglietto: null, timbroMs: dueMinutiFa, adesso: ADESSO }), []);
});

test('processi: contano quelli sotto la cartella o in un worktree estraneo; non chi chiede, la sua shell, i battiti, gli zombie', () => {
  const root = '/home/user/Filo';
  const wt = '/tmp/filo-fusione-abc123/ramo';
  const p = (pid, cwd, cmd, extra = {}) => ({ pid, sid: pid, stato: 'S', cwd, cmd, ...extra });
  const processi = [
    p(635, root, 'node scripts/finish-local.mjs --check'),
    p(700, `${root}/src`, 'npx playwright test tests/x.spec.mjs'),
    p(701, wt, 'node scripts/run-unit-tests.mjs'),
    p(702, '/home/user', 'bash'),
    p(703, '/home/user/Filone', 'node altro'),
    p(800, root, 'node /tmp/filo-strumenti/scripts/routine-channel.mjs heartbeat --loop'),
    p(801, root, 'node scripts/routine-channel.mjs heartbeat'),
    p(802, root, 'node morto', { stato: 'Z' }),
    p(900, root, 'node dispatch.mjs --linea-principale', { sid: 950 }),
    p(901, root, 'tail -5', { sid: 950 }),
    p(204, root, '/opt/claude-code/bin/claude'),
  ];
  const segni = segniDiLavoroVivo({ processi, cartelle: [root, wt], esclusi: new Set([900, 204]), sessione: 950, adesso: ADESSO, platform: 'linux' });
  assert.deepEqual(segni.map((s) => s.pid), [635, 700, 701]);
  assert.match(segni[0].cmd, /finish-local/);
  assert.deepEqual(segniDiLavoroVivo({ processi: null, cartelle: [root] }), [], 'fuori da Linux i processi non si vedono');
  assert.deepEqual(segniDiLavoroVivo({ processi, cartelle: [root, wt], cosa: ['battito', 'timbro'] }), []);
});

test('chi chiede: lui, i suoi antenati e la shell che li ha aperti; una sessione che non è sua no', () => {
  const processi = [
    { pid: 1, ppid: 0, sid: 1 }, { pid: 204, ppid: 148, sid: 0 }, { pid: 148, ppid: 1, sid: 86 },
    { pid: 950, ppid: 204, sid: 950 }, { pid: 951, ppid: 950, sid: 950 }, { pid: 960, ppid: 950, sid: 950 },
    { pid: 970, ppid: 204, sid: 970 },
  ];
  const q = questoProcesso(processi, 951);
  assert.deepEqual([...q.esclusi].sort((a, b) => a - b), [1, 148, 204, 950, 951]);
  assert.equal(q.sessione, 950, 'il resto della riga di comando (una pipe) è della stessa shell');
  assert.equal(questoProcesso([{ pid: 5, ppid: 204, sid: 0 }, { pid: 204, ppid: 1, sid: 0 }], 5).sessione, 0);
});

test('il testo del rifiuto dice chi è vivo, senza codici lunghi e copiabile dentro un --guasto', () => {
  assert.equal(comandoLeggibile(`node routine-channel.mjs ticket ${T1}`), `node routine-channel.mjs ticket ${T1.slice(0, 6)}…`);
  const testo = testoLavoroVivo({
    segni: [
      { tipo: 'battito', biglietto: T1.slice(0, 8), pid: 635 },
      { tipo: 'timbro', biglietto: T1.slice(0, 8), etaMs: 120000 },
      { tipo: 'processo', pid: 700, cmd: 'bash -c "echo $HOME"', cwd: '/home/user/Filo' },
    ],
    commit: { ramo: 'worker/x', sha: 'abc1234', quando: '2 minutes ago', titolo: 'auto: "a.js"' },
  }, 'riportato la cartella su main');
  for (const atteso of ['non ho riportato la cartella su main', 'AAAAAAAA', 'pid 635', '2 minuti fa', 'processo 700', 'abc1234', 'worker/x']) {
    assert.ok(testo.includes(atteso), `${atteso} in: ${testo}`);
  }
  assert.doesNotMatch(testo, /["`$]/);
  // Una suite che gira sono decine di processi: i primi comandi veri, le shell dopo, e il numero del resto.
  const tanti = [{ tipo: 'processo', pid: 1, cmd: '/bin/bash -c source snap.sh && npm run finish:check', cwd: '/r' },
    ...Array.from({ length: 9 }, (_, i) => ({ tipo: 'processo', pid: 10 + i, cmd: `node --test f${i}.mjs`, cwd: '/r' }))];
  const lungo = testoLavoroVivo({ segni: tanti, commit: null }, 'provato');
  assert.match(lungo, /^lavoro ancora vivo nella cartella: non ho provato\. processo 10 /);
  assert.match(lungo, /e altri 4 processi\.$/);
  assert.doesNotMatch(lungo, /snap\.sh/);
  assert.ok(sottoCartella('/a/b/c', '/a/b') && !sottoCartella('/a/bc', '/a/b') && sottoCartella('/a/b', '/a/b'));
});

// ─── Le porte vere: dispatch e canale su un repo vero ──────────────────────────

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function cartellaSulRamo() {
  const casa = cartellaTemporanea('filo-lavoro-vivo-');
  const origine = join(casa, 'origine.git');
  const semina = join(casa, 'semina');
  const clone = join(casa, 'clone');
  git(casa, 'init', '-q', '--bare', origine);
  mkdirSync(semina);
  git(semina, 'init', '-q', '-b', 'main');
  git(semina, 'config', 'user.email', 't@t');
  git(semina, 'config', 'user.name', 't');
  writeFileSync(join(semina, 'codice.txt'), 'uno\n');
  git(semina, 'add', '-A');
  git(semina, 'commit', '-qm', 'inizio');
  git(semina, 'branch', 'worker/vivo');
  git(semina, 'push', '-q', origine, 'main', 'worker/vivo');
  git(casa, 'clone', '-q', origine, clone);
  git(clone, 'config', 'user.email', 't@t');
  git(clone, 'config', 'user.name', 't');
  const r = prepareBranch({ root: clone, branch: 'worker/vivo', mainBranch: 'main' });
  assert.equal(r.ok, true, r.message);
  mkdirSync(join(clone, '.claude'), { recursive: true });
  writeExpectation(clone, { branch: 'worker/vivo', id: 'fb1' });
  // Il worker vivo ha una modifica a metà, non ancora salvata.
  writeFileSync(join(clone, 'codice.txt'), 'a metà\n');
  return { casa, clone };
}

// Un processo che vive in un'altra sessione, come un comando lanciato in sottofondo da chi lavora.
function processoVivo(cwd) {
  const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd, detached: true, stdio: 'ignore' });
  p.unref();
  return p;
}
const ferma = (p) => { try { process.kill(p.pid); } catch (_) { /* già uscito */ } };

function battitoDi(clone, pid, ticket = T1) {
  mkdirSync(join(clone, '.claude'), { recursive: true });
  writeFileSync(beatFile(clone), JSON.stringify({ pid, ticket, since: new Date().toISOString(), root: resolve(clone) }));
}

const ambiente = (clone, extra = {}) => ({
  ...process.env, FILO_REPO_ROOT: clone, FILO_DISPATCH_STATE_DIR: join(clone, '..', 'stato'), FILO_NO_BEAT: '1', FILO_ROUTINE: '1',
  FILO_ROUTINE_TICKET: '', ...extra,
});
const lineaPrincipale = (clone) => spawnSync(process.execPath, [DISPATCH, '--linea-principale'], { encoding: 'utf8', env: ambiente(clone) });

test('--linea-principale col battito vivo di un altro biglietto: esce 5, la cartella resta sul ramo con la modifica', () => {
  const { casa, clone } = cartellaSulRamo();
  const vivo = processoVivo(casa);
  try {
    battitoDi(clone, vivo.pid);
    const r = lineaPrincipale(clone);
    assert.equal(r.status, USCITA_LAVORO_VIVO, r.stderr);
    assert.match(r.stderr, new RegExp(`LAVORO VIVO.*biglietto ${T1.slice(0, 8)}.*pid ${vivo.pid}`));
    assert.match(r.stderr, /Ultimo commit della cartella: [0-9a-f]{7,}/);
    assert.equal(git(clone, 'branch', '--show-current'), 'worker/vivo');
    assert.equal(readFileSync(join(clone, 'codice.txt'), 'utf8'), 'a metà\n');
    assert.ok(existsSync(join(clone, '.claude', 'branch-expect.json')), 'la guardia del worker vivo resta');
  } finally {
    ferma(vivo);
    togliCartella(casa);
  }
});

test('--linea-principale con un processo che lavora nella cartella: esce 5 col pid e il comando', { skip: !LINUX && 'i processi si leggono da /proc' }, () => {
  const { casa, clone } = cartellaSulRamo();
  const vivo = processoVivo(clone);
  try {
    const r = lineaPrincipale(clone);
    assert.equal(r.status, USCITA_LAVORO_VIVO, r.stderr);
    assert.match(r.stderr, new RegExp(`processo ${vivo.pid} «[^»]*setInterval`));
    assert.equal(git(clone, 'branch', '--show-current'), 'worker/vivo');
  } finally {
    ferma(vivo);
    togliCartella(casa);
  }
});

test('--linea-principale senza lavoro vivo (battito spento, timbro di prima del rilascio): va su main come sempre', () => {
  const { casa, clone } = cartellaSulRamo();
  try {
    battitoDi(clone, 999999);
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date().toISOString(), morto: { ora: new Date(Date.now() + 1000).toISOString(), perche: 'rilasciato' } }));
    writeFileSync(timbroFile(clone), '');
    const r = lineaPrincipale(clone);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(clone, 'branch', '--show-current'), 'main');
  } finally {
    togliCartella(casa);
  }
});

test('un worker nuovo con un altro vivo nella cartella: halt col guasto, e biglietto, battito e ruolo restano di chi lavora', () => {
  const { casa, clone } = cartellaSulRamo();
  const vivo = processoVivo(casa);
  try {
    battitoDi(clone, vivo.pid);
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date().toISOString() }));
    writeFileSync(join(clone, '.claude', 'routine-role.json'), JSON.stringify({ role: 'verifier' }));
    const r = spawnSync(process.execPath, [DISPATCH, '--ticket', T2], {
      encoding: 'utf8', env: ambiente(clone, { FILO_ROUTINE_API: 'http://127.0.0.1:9' }),
    });
    assert.equal(r.status, USCITA_LAVORO_VIVO, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.role, 'halt');
    assert.match(out.payload.message, /lavoro ancora vivo nella cartella: non ho preso la cartella/);
    assert.equal(JSON.parse(readFileSync(ticketFile(clone), 'utf8')).ticket, T1);
    assert.equal(JSON.parse(readFileSync(beatFile(clone), 'utf8')).pid, vivo.pid);
    assert.ok(existsSync(join(clone, '.claude', 'routine-role.json')));
    assert.equal(git(clone, 'branch', '--show-current'), 'worker/vivo');
  } finally {
    ferma(vivo);
    togliCartella(casa);
  }
});

test('lo stesso worker che rilancia dispatch col suo biglietto non si ferma sui propri processi', { skip: !LINUX && 'i processi si leggono da /proc' }, () => {
  const { casa, clone } = cartellaSulRamo();
  const suo = processoVivo(clone);
  try {
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T2, since: new Date().toISOString() }));
    const r = spawnSync(process.execPath, [DISPATCH, '--ticket', T2], {
      encoding: 'utf8', env: ambiente(clone, { FILO_ROUTINE_API: 'http://127.0.0.1:9' }),
    });
    assert.notEqual(r.status, USCITA_LAVORO_VIVO, r.stderr);
    assert.doesNotMatch(r.stderr, /LAVORO VIVO/);
  } finally {
    ferma(suo);
    togliCartella(casa);
  }
});

// ─── Il rilascio ──────────────────────────────────────────────────────────────

async function canaleFinto() {
  const chiamate = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      chiamate.push(String(req.url || ''));
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineHeartbeat')) res.end(JSON.stringify({ ok: false, reason: 'dead_ticket' }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { srv, chiamate, api: `http://127.0.0.1:${srv.address().port}` };
}
const canale = (clone, api, ...args) => new Promise((ok) => {
  const p = spawn(process.execPath, [CANALE, ...args], { env: ambiente(clone, { FILO_ROUTINE_API: api }) });
  let so = ''; let se = '';
  p.stdout.on('data', (c) => { so += c; });
  p.stderr.on('data', (c) => { se += c; });
  p.on('close', (code) => ok({ code, so, se }));
});

test('release --role orchestrator col timbro di 2 minuti: rifiuta, niente al server; timbro vecchio e battito spento: rilascia', async () => {
  const { casa, clone } = cartellaSulRamo();
  const { srv, chiamate, api } = await canaleFinto();
  try {
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date(Date.now() - 3600000).toISOString() }));
    battitoDi(clone, 999999);
    writeFileSync(timbroFile(clone), '');
    const dueMinutiFa = (Date.now() - 2 * 60000) / 1000;
    utimesSync(timbroFile(clone), dueMinutiFa, dueMinutiFa);
    const r = await canale(clone, api, 'release', T1, '--role', 'orchestrator', '--senza-rapporto');
    assert.equal(r.code, USCITA_LAVORO_VIVO, r.se);
    assert.match(r.se, /LAVORO VIVO.*ha salvato 2 minuti fa/);
    assert.ok(!chiamate.some((u) => u.endsWith('/routineRelease')), 'il biglietto di chi lavora non si rilascia');
    assert.equal(readFileSync(join(clone, 'codice.txt'), 'utf8'), 'a metà\n', 'né si committa il suo lavoro a metà');

    const vecchio = (Date.now() - 30 * 60000) / 1000;
    utimesSync(timbroFile(clone), vecchio, vecchio);
    const ok = await canale(clone, api, 'release', T1, '--role', 'orchestrator', '--senza-rapporto');
    assert.equal(ok.code, 0, ok.se);
    assert.match(ok.so, /OK: biglietto rilasciato/);
    assert.equal(JSON.parse(readFileSync(ticketFile(clone), 'utf8')).morto.perche, 'rilasciato');
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('release --role orchestrator --forza rilascia anche col timbro fresco', async () => {
  const { casa, clone } = cartellaSulRamo();
  const { srv, chiamate, api } = await canaleFinto();
  try {
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date().toISOString() }));
    writeFileSync(timbroFile(clone), '');
    const r = await canale(clone, api, 'release', T1, '--role', 'orchestrator', '--forza', '--senza-rapporto');
    assert.equal(r.code, 0, r.se);
    assert.ok(chiamate.some((u) => u.endsWith('/routineRelease')));
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('il rilascio di un worker aspetta i suoi processi nella cartella', { skip: !LINUX && 'i processi si leggono da /proc' }, async () => {
  const { casa, clone } = cartellaSulRamo();
  const { srv, chiamate, api } = await canaleFinto();
  const vivo = processoVivo(clone);
  try {
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date().toISOString() }));
    const r = await canale(clone, api, 'release', T1, '--role', 'resolver', '--senza-rapporto');
    assert.equal(r.code, USCITA_LAVORO_VIVO, r.se);
    assert.match(r.se, new RegExp(`processo ${vivo.pid}`));
    assert.match(r.se, /Aspetta che finiscano/);
    assert.ok(!chiamate.some((u) => u.endsWith('/routineRelease')));
    ferma(vivo);
    await aspettaChe(() => { try { process.kill(vivo.pid, 0); return false; } catch (_) { return true; } }, { cosa: 'il processo fermato non esce' });
    const ok = await canale(clone, api, 'release', T1, '--role', 'resolver', '--senza-rapporto');
    assert.equal(ok.code, 0, ok.se);
  } finally {
    ferma(vivo);
    srv.close();
    togliCartella(casa);
  }
});

test('un rilascio con la cartella di un altro biglietto non committa, non spedisce e non tocca il marcatore', async () => {
  const { casa, clone } = cartellaSulRamo();
  const { srv, api } = await canaleFinto();
  try {
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date().toISOString() }));
    const prima = git(clone, 'rev-parse', 'HEAD');
    const r = await canale(clone, api, 'release', T2, '--role', 'halt', '--guasto', 'lavoro vivo', '--senza-rapporto');
    assert.equal(r.code, 0, r.se);
    assert.match(r.se, /la cartella è del biglietto AAAAAAAA…, non di questo/);
    assert.equal(git(clone, 'rev-parse', 'HEAD'), prima);
    assert.equal(readFileSync(join(clone, 'codice.txt'), 'utf8'), 'a metà\n');
    assert.equal(JSON.parse(readFileSync(ticketFile(clone), 'utf8')).morto, undefined);
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('il battito che risponde biglietto morto lo segna nel marcatore', async () => {
  const { casa, clone } = cartellaSulRamo();
  const { srv, api } = await canaleFinto();
  try {
    writeFileSync(ticketFile(clone), JSON.stringify({ ticket: T1, since: new Date().toISOString() }));
    const r = await canale(clone, api, 'heartbeat', T1);
    assert.equal(r.code, 3);
    assert.equal(JSON.parse(readFileSync(ticketFile(clone), 'utf8')).morto.perche, 'dead_ticket');
    assert.equal(lavoroVivo(clone, { cosa: ['timbro'] }).vivo, false);
  } finally {
    srv.close();
    togliCartella(casa);
  }
});
