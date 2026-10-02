// #913: il feedback di un utente (o di una routine) che l'owner approva come lavoro locale (`localApproval`).
// I CASI sono gli stessi di functions/test/lavoro-locale-approvato-913.test.js in filo-security: client e server
// devono dare lo stesso esito, perché la Gestione dice «si fonde senza chiedere» esattamente quando il server lo fa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

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

test('--approva-locale: dai Ricevuti a todo approvato, col segno e col sì nella stessa scrittura', async () => {
  const doc = documento('u1', { clientId: 'utente-7', status: 'design', statusReason: 'locale', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await of.approvaLocale('u1', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.from, 'design');
    assert.equal(patch.length, 1);
    for (const c of ['status', 'statusPublic', 'reviewDecision', 'reviewedAt', 'localOnly', 'localApproval']) {
      assert.match(patch[0].url, new RegExp(`updateMask\\.fieldPaths=${c}(&|$)`), c);
    }
    const f = patch[0].body.fields;
    assert.equal(f.statusPublic.stringValue, 'open');
    assert.ok(f.localApproval.mapValue.fields.by.stringValue);
    assert.match(f.localApproval.mapValue.fields.at.integerValue, /^\d{13}$/);
  });
});

test('--approva-locale rifiuta senza scrivere: segnalato, fuori dai Ricevuti, già approvato, sessione con la prova', async () => {
  const casi = [
    [{ clientId: 'utente-7', status: 'attack', statusPublic: 'open' }, /solo l’owner, in Gestione/],
    [{ clientId: 'utente-7', status: 'todo', statusPublic: 'open' }, /dai Ricevuti/],
    [{ clientId: 'utente-7', status: 'design', statusPublic: 'open', localApproval: mappa(SI) }, /già approvato/],
    [{ clientId: 'local:claude', senderProof: 'admin', status: 'design', statusPublic: 'open' }, /basta il segno/],
  ];
  for (const [campi, motivo] of casi) {
    await conRete(documento('x', campi), async (patch) => {
      const r = await of.approvaLocale('x', OPTS);
      assert.equal(r.ok, false, JSON.stringify(campi));
      assert.match(r.motivo, motivo);
      assert.equal(patch.length, 0);
    });
  }
});

test('approvato: start/finish --feedback e i passaggi del lavoro lo accettano; senza il sì no, e il rifiuto dice la strada', async () => {
  const approvato = documento('a1', {
    clientId: 'utente-7', status: 'todo', statusPublic: 'open', localOnly: mappa(SEGNO), localApproval: mappa(SI), notes: '',
  });
  await conRete(approvato, async () => {
    const r = await of.praticaPerLaSessione('a1', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.avviso, '');
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
    assert.match(of.rifiutoPratica('913', r), /--approva-locale/);
  });
  const routine = documento('r1', { clientId: 'routine:worker', senderProof: 'server', status: 'design', statusPublic: 'open' });
  await conRete(routine, async () => {
    const r = await of.praticaPerLaSessione('r1', OPTS);
    assert.equal(r.ok, false);
    assert.match(of.rifiutoPratica('914', r), /--approva-locale/);
  });
});

test('--non-locale su un approvato toglie il segno e lascia il sì: il segno si rimette senza tornare nei Ricevuti', async () => {
  const doc = documento('a2', {
    clientId: 'utente-7', status: 'todo', statusPublic: 'open', localOnly: mappa(SEGNO), localApproval: mappa(SI),
  });
  await conRete(doc, async (patch) => {
    const r = await of.segnaLocale('a2', false, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.match(patch[0].url, /updateMask\.fieldPaths=localApproval/);
    assert.deepEqual(patch[0].body.fields, {});
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
