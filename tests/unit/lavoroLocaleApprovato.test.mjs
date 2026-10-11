// #913: il feedback di un utente (o di una routine) che l'owner approva come lavoro locale (`localApproval`).
// I CASI sono gli stessi di functions/test/lavoro-locale-approvato-913.test.js in filo-security: client e server
// devono dare lo stesso esito, perché la Gestione dice «si fonde senza chiedere» esattamente quando il server lo fa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const MR = globalThis.SN_MANAGE_REVIEW;
const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const { avvisoDaCampi } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'pratica-locale.mjs')).href);
const { mittenteInParole } = await import(pathToFileURL(join(ROOT, 'scripts', 'leggi-feedback.mjs')).href);

const SEGNO = Object.freeze({ by: 'owner@esempio', at: 1759400000000 });
const SI = Object.freeze({ by: 'owner@esempio', at: 1759400000001 });

// [nome, feedback, lavoro locale ammesso]. Copia esatta del gemello nel server.
const CASI = [
  ['utente senza approvazione', { clientId: 'utente-7', status: 'todo', localOnly: SEGNO }, false],
  ['utente approvato dall’owner', { clientId: 'utente-7', status: 'todo', localOnly: SEGNO, localApproval: SI }, true],
  ['sessione con la prova', { clientId: 'local:claude', senderProof: 'admin', status: 'todo', localOnly: SEGNO }, true],
  ['owner con la prova', { clientId: 'owner:app', senderProof: 'admin', status: 'working', localOnly: SEGNO }, true],
  ['routine senza approvazione', { clientId: 'routine:worker', senderProof: 'server', status: 'todo', localOnly: SEGNO }, false],
  ['routine approvata dall’owner', { clientId: 'routine:worker', senderProof: 'server', status: 'todo', localOnly: SEGNO, localApproval: SI }, true],
  ['prefisso di sessione senza prova', { clientId: 'local:claude', status: 'todo', localOnly: SEGNO }, false],
  ['approvato ma senza il segno locale', { clientId: 'utente-7', status: 'todo', localApproval: SI }, false],
  ['approvazione senza firma', { clientId: 'utente-7', status: 'todo', localOnly: SEGNO, localApproval: { by: '  ', at: 1 } }, false],
  ['approvazione non mappa', { clientId: 'utente-7', status: 'todo', localOnly: SEGNO, localApproval: true }, false],
];

test('i casi del gemello: lavoro locale (e fusione senza chiedere) solo con la prova o col sì dell’owner', () => {
  for (const [nome, fb, atteso] of CASI) {
    assert.equal(MR.isProvenLocalWork(fb), atteso, nome);
  }
});

test('una sessione lega il lavoro solo a chi ha la prova o il sì: utente e routine senza, rifiutati col motivo', () => {
  assert.equal(MR.localSenderCheck({ clientId: 'utente-7' }).ok, false);
  assert.equal(MR.localSenderCheck({ clientId: 'utente-7' }).utente, true);
  assert.match(MR.localSenderCheck({ clientId: 'utente-7' }).motivo, /approva come lavoro locale/);
  const routine = MR.localSenderCheck({ clientId: 'routine:worker', senderProof: 'server' });
  assert.deepEqual([routine.ok, routine.routine], [false, true]);
  assert.deepEqual(MR.localSenderCheck({ clientId: 'utente-7', localApproval: SI }), { ok: true, approvato: true });
  assert.deepEqual(MR.localSenderCheck({ clientId: 'routine:worker', senderProof: 'server', localApproval: SI }), { ok: true, approvato: true });
  assert.deepEqual(MR.localSenderCheck({ clientId: 'local:claude', senderProof: 'admin' }), { ok: true });
  // Approvato, il segno si rimette come per i feedback dell'owner.
  assert.equal(MR.localSignCheck({ clientId: 'utente-7', status: 'todo', localApproval: SI }, true).ok, true);
  assert.equal(MR.localSignCheck({ clientId: 'utente-7', status: 'todo' }, true).ok, false);
});

test('il tasto dei Ricevuti: c’è su utente e routine, non sui propri, non fuori dai Ricevuti', () => {
  const ricevuto = { clientId: 'utente-7', status: 'design', statusReason: 'locale', statusPublic: 'open' };
  const az = MR.ownerActionFor(ricevuto, 'accept_local');
  assert.ok(az, 'utente nei Ricevuti');
  assert.deepEqual([az.kind, az.to, az.locale, az.primary], ['accept', 'todo', true, true], 'rimandato per lavoro locale: è la scelta attesa');
  const qualunque = MR.ownerActions({ ...ricevuto, statusReason: '' });
  assert.deepEqual(qualunque.filter((a) => a.primary).map((a) => a.key), ['accept'], 'altrimenti resta secondario');
  assert.ok(MR.ownerActionAllowsStatus(ricevuto, 'todo'));
  assert.ok(MR.ownerActionFor({ ...ricevuto, clientId: 'routine:worker', senderProof: 'server' }, 'accept_local'), 'routine (#914)');
  assert.ok(MR.ownerActionFor({ ...ricevuto, clientId: 'local:claude' }, 'accept_local'), 'prefisso senza prova = utente');
  assert.equal(MR.ownerActionFor({ ...ricevuto, clientId: 'owner:me', senderProof: 'admin' }, 'accept_local'), null, 'ai propri basta il segno');
  assert.equal(MR.ownerActionFor({ ...ricevuto, localOnly: SEGNO, localApproval: SI }, 'accept_local'), null, 'già approvato');
  assert.equal(MR.ownerActionFor({ ...ricevuto, status: 'todo' }, 'accept_local'), null, 'in coda');
  assert.equal(MR.ownerActionFor({ ...ricevuto, status: 'archived' }, 'accept_local'), null);
  assert.equal(MR.ownerActionFor({ ...ricevuto, status: 'FENC1:xyz' }, 'accept_local'), null, 'stato illeggibile');
  // Un segnalato si approva lo stesso, ma il motivo arriva all'hover.
  const attacco = MR.localApprovalCheck({ ...ricevuto, status: 'attack' });
  assert.equal(attacco.ok, true);
  assert.match(attacco.segnalato, /attacco/);
  assert.equal(MR.localApprovalCheck(ricevuto).segnalato, undefined);
});

test('la fusione che il client promette è quella del server: approvato in lavorazione → «si fonde senza chiedere»', () => {
  const approvato = { clientId: 'utente-7', status: 'working', statusPublic: 'open', localOnly: SEGNO, localApproval: SI };
  assert.equal(MR.manageTabFor(approvato), 'local');
  assert.equal(MR.isProvenLocalWork(approvato), true);
  assert.equal(avvisoDaCampi({ localOnly: { mapValue: {} }, localApproval: { mapValue: {} }, statusPublic: { stringValue: 'open' } }), '');
  assert.match(avvisoDaCampi({ localOnly: { mapValue: {} }, statusPublic: { stringValue: 'open' } }), /approvazione dell’owner/);
});

test('il lettore dice chi l’ha scritto anche dopo il sì: resta un utente', () => {
  assert.equal(mittenteInParole({ clientId: 'utente-7' }), 'un utente');
  assert.equal(mittenteInParole({ clientId: 'utente-7', localApproval: SI }), 'un utente (approvato dall’owner come lavoro locale)');
});

// ── Lo script, con la rete finta ──────────────────────────────────────────────

const campo = (v) => (typeof v === 'string' ? { stringValue: v } : v);
function documento(id, f) {
  const fields = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined) fields[k] = campo(v);
  return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields };
}
async function conRete(doc, fn) {
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try { return await fn(patch); } finally { globalThis.fetch = vero; }
}
const OPTS = { bearer: 'tok-finto' };
const mappa = (o) => ({ mapValue: { fields: { by: { stringValue: o.by }, at: { integerValue: String(o.at) } } } });

// #957: il sì si dà solo col tasto in Gestione. Le regole non distinguono la pagina da uno script col token
// dell'owner, quindi il limite sta negli strumenti delle sessioni: nessuno lo scrive, e la via tolta si rifiuta.
test('--approva-locale e --riconosci non ci sono più: la riga di comando rifiuta prima delle credenziali e rimanda a Gestione', () => {
  assert.equal(of.approvaLocale, undefined, 'lo script non deve più saper scrivere il sì');
  assert.equal(of.riconosciMittente, undefined, 'né la prova del mittente');
  const lancia = (args, extra = {}) => {
    const env = { ...process.env, ...extra };
    for (const k of Object.keys(env)) if (k.startsWith('npm_config_') && !(k in extra)) delete env[k];
    return spawnSync(process.execPath, [join(ROOT, 'scripts', 'owner-feedback.mjs'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: TETTO_ATTESA_MS });
  };
  for (const [nome, r] of [
    ['opzione', lancia(['feedback-finto-957', '--approva-locale', '--dry-run'])],
    ['con l’uguale', lancia(['feedback-finto-957', '--approva-locale=1', '--dry-run'])],
    ['mangiata da npm', lancia(['feedback-finto-957', '--dry-run'], { npm_config_approva_locale: 'true' })],
    ['--riconosci', lancia(['feedback-finto-957', '--riconosci', '--dry-run'])],
    ['--riconosci mangiata da npm', lancia(['feedback-finto-957', '--dry-run'], { npm_config_riconosci: 'true' })],
  ]) {
    const mio = /riconosci/.test(nome);
    assert.equal(r.status, 1, `${nome}: ${r.stderr}`);
    assert.match(r.stderr, mio ? /RIFIUTATO: --riconosci non c'è più/ : /RIFIUTATO: --approva-locale non c'è più/, nome);
    assert.match(r.stderr, mio ? /in Gestione, col tasto «🙋 È mio»/ : /in Gestione, col tasto «💻 Lavoro locale»/, nome);
    assert.doesNotMatch(r.stdout, /^Auth:/m, `${nome}: non deve nemmeno prendere le credenziali`);
  }
});

// La prova del mittente la scrive solo il ripasso, che la deduce da segni che un falso non ha (regole: ripassoMittenti.test.mjs).
const SCRIVE_LA_PROVA = new Set(['ripasso-mittenti.mjs']);
test('nessuno strumento delle sessioni scrive il sì come lavoro locale, né la prova del mittente su un feedback esistente', () => {
  const file = [];
  const giro = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== 'node_modules') giro(join(dir, e.name)); } else if (/\.(mjs|cjs|js)$/.test(e.name)) file.push(join(dir, e.name));
    }
  };
  giro(join(ROOT, 'scripts'));
  assert.ok(file.length > 20, 'cartella degli strumenti non trovata');
  for (const f of file) {
    const testo = readFileSync(f, 'utf8');
    assert.doesNotMatch(testo, /fieldPaths=localApproval|set\(\s*['"`]localApproval['"`]|localApproval\s*:\s*(\{\s*mapValue|toFsValue|segno)/, `${f} scrive localApproval`);
    if (!SCRIVE_LA_PROVA.has(f.split(/[\\/]/).pop())) assert.doesNotMatch(testo, /fieldPaths=senderProof/, `${f} scrive senderProof su un feedback esistente`);
  }
});

test('approvato: start/finish --feedback e i passaggi del lavoro lo accettano; senza il sì no, e il rifiuto dice la strada', async () => {
  const approvato = documento('a1', {
    clientId: 'utente-7', status: 'todo', statusPublic: 'open', localOnly: mappa(SEGNO), localApproval: mappa(SI), notes: '',
  });
  await conRete(approvato, async () => {
    const r = await of.praticaPerLaSessione('a1', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.doesNotMatch(r.avviso, /L5/, 'il sì vale quanto la prova: niente avviso sulla fusione');
    assert.match(r.avviso, /frase/, 'chi l’ha mandato è un utente: la frase per lui la scrive la sessione');
  });
  await conRete(approvato, async (patch) => {
    const r = await of.scrivi('a1', 'working', 'presa in carico', { ...OPTS, attore: 'routine', dryRun: true });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 0);
  });
  const senza = documento('n1', { clientId: 'utente-7', status: 'design', statusPublic: 'open', localOnly: mappa(SEGNO) });
  await conRete(senza, async () => {
    const r = await of.praticaPerLaSessione('n1', OPTS);
    assert.equal(r.ok, false);
    assert.equal(r.utente, true);
    const rifiuto = of.rifiutoPratica('913', r);
    assert.doesNotMatch(rifiuto, /--approva-locale/);
    assert.match(rifiuto, /in Gestione, col tasto «💻 Lavoro locale».*da riga di comando non si può/);
  });
  const routine = documento('r1', { clientId: 'routine:worker', senderProof: 'server', status: 'design', statusPublic: 'open' });
  await conRete(routine, async () => {
    const r = await of.praticaPerLaSessione('r1', OPTS);
    assert.equal(r.ok, false);
    assert.doesNotMatch(of.rifiutoPratica('914', r), /--approva-locale/);
    assert.match(of.rifiutoPratica('914', r), /solo l’owner, in Gestione/);
  });
});

test('--non-locale su un approvato toglie il segno e lascia il sì: il segno si rimette senza tornare nei Ricevuti', async () => {
  const doc = documento('a2', {
    clientId: 'utente-7', status: 'todo', statusPublic: 'open', localOnly: mappa(SEGNO), localApproval: mappa(SI),
  });
  await conRete(doc, async (patch) => {
    const r = await of.segnaLocale('a2', false, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.match(patch[0].url, /updateMask\.fieldPaths=localOnly&updateMask\.fieldPaths=updatedAt$/);
    assert.deepEqual(Object.keys(patch[0].body.fields), ['updatedAt'], 'nessun valore, solo la firma dell\'ora');
  });
});

// Il gemello è il test di guardPublicCard nel server: stessa regola, isPrivateLocalWork.
test('#913: risolto, il feedback di un utente approvato come lavoro locale tiene la scheda pubblica; il lavoro dell’owner no', () => {
  require(join(ROOT, 'src', 'shared', 'feedbackPublicView.js'));
  const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
  const base = { _id: 'u-1', name: 'Il terminale non parte', seq: 950, subSeq: 0, status: 'done', statusPublic: 'closed', createdAt: '2026-10-01T07:00:00Z' };
  assert.notEqual(V.cardFor({ ...base, clientId: 'utente-7', localOnly: SEGNO, localApproval: SI }), null);
  assert.equal(V.cardFor({ ...base, clientId: 'local:claude', senderProof: 'admin', localOnly: SEGNO }), null);
  assert.equal(MR.isPrivateLocalWork({ clientId: 'utente-7', localOnly: SEGNO, localApproval: SI }), false);
  assert.equal(MR.isPrivateLocalWork({ clientId: 'local:claude', senderProof: 'admin', localOnly: SEGNO }), true);
});

test('#913: tolto il segno, il sì dell’owner resta e il segno si rimette, anche da riga di comando', async () => {
  const fb = { clientId: 'utente-7', status: 'todo', statusPublic: 'open', localApproval: SI };
  assert.equal(MR.localSignCheck(fb, true).ok, true, MR.localSignCheck(fb, true).motivo);
});

test('#913: fuso sopra L5 per il sì dell’owner, la riga del finish e Automazioni lo dicono; la prova resta prova', async () => {
  const OM = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'owner-merge.mjs')).href);
  require(join(ROOT, 'src', 'shared', 'mergeApprovals.js'));
  const MA = globalThis.SN_MERGE_APPROVALS;
  const riga = (local) => OM.messageForOwnerMerge(OM.classifyOwnerMerge(200, {
    result: { ok: true, result: 'merged', sha: 'b'.repeat(40), local: { feedbackId: 'f', eligible: true, num: '#950', skippedL5: true, blocks: [], record: 'r', closed: true, ...local } },
  }), 'claude/x', { feedbackNum: '950', feedbackId: 'f' });
  assert.match(riga({ approvato: true }), /L5 saltato: lavoro locale di #950, feedback di un utente che hai approvato/);
  assert.doesNotMatch(riga({ approvato: true }), /mittente provato/);
  assert.match(riga({}), /mittente provato/);
  assert.match(riga({ approvato: true, daRoutine: true }), /feedback di una routine che hai approvato/);
  assert.doesNotMatch(riga({ approvato: true, daRoutine: true }), /di un utente/);
  const approvato = MA.skippedL5Hint({ skippedL5: true, localApproved: true, preapprovedBy: 'owner@esempio' });
  assert.match(approvato, /approvato come lavoro locale da owner@esempio/);
  assert.doesNotMatch(approvato, /prova del mittente/);
  assert.match(MA.skippedL5Hint({ skippedL5: true }), /prova del mittente/);
});
