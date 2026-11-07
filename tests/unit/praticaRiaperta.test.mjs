// Il registro delle parti di un lavoro locale (#915) non sopravvive a una riapertura (#938), e una parte tardiva che
// trova un ramo dell'altra parte ancora in arrivo riapre la pratica invece di lasciarla chiusa. Rete finta che applica
// le scritture come Firestore; la strada di Gestione sta in tests/pratica-riaperta-parti.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as of from '../../scripts/owner-feedback.mjs';
import { esegui } from '../../scripts/server-fondi-pratica.mjs';
import { riapriPerIlServer } from '../../scripts/finish-local.mjs';
import { partiDaCampi } from '../../scripts/lib/parti-lavoro.mjs';
import { FIRESTORE_BASE } from '../../scripts/lib/firestore-auth.mjs';
import { PULITO } from '../helpers/bigliettoFinto.mjs';

const FB = globalThis.SN_FEEDBACK;
const ORA = Date.parse('2026-10-03T10:00:00Z');
const ORE = 3600 * 1000;
const OPTS = { bearer: 'finto' };
// Una sessione col biglietto pulito: la nota su un fidato da una sessione sporca ha le sue prove in notaTogliFiducia.test.mjs.
of.sessione.biglietto = async () => PULITO;

const valore = (v) => (typeof v === 'string' ? { stringValue: v } : { integerValue: String(v) });

function pratica(id, { status = 'todo', parti = null } = {}) {
  const fields = {
    seq: { integerValue: '938' }, clientId: { stringValue: 'local:claude' }, senderProof: { stringValue: 'admin' },
    fiducia: { stringValue: 'fidato' }, status: { stringValue: status }, statusPublic: { stringValue: FB.statusToPublic(status) },
    notes: { stringValue: '' },
    localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
  };
  if (parti) fields.localMerges = { mapValue: { fields: Object.fromEntries(Object.entries(parti).map(([k, v]) => [k, valore(v)])) } };
  return { name: `projects/x/databases/(default)/documents/feedback/${id}`, fields };
}

// Una PATCH come la applica Firestore: un campo nella maschera e non nel corpo se ne va, `a.b` tocca solo la chiave b.
function applica(fields, percorso, nuovi) {
  const [k, sub] = percorso.split('.');
  if (!sub) {
    if (k in nuovi) fields[k] = nuovi[k]; else delete fields[k];
    return;
  }
  const mappa = { ...(fields[k]?.mapValue?.fields || {}) };
  const v = nuovi[k]?.mapValue?.fields?.[sub];
  if (v === undefined) delete mappa[sub]; else mappa[sub] = v;
  fields[k] = { mapValue: { fields: mappa } };
}

// Lo stato si scrive in chiaro, così la rete finta lo rilegge com'è: la cifratura ha le sue prove.
async function conRete(docs, fn) {
  const vero = globalThis.fetch;
  const cifra = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  const scritture = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const id = decodeURIComponent(u.pathname.split('/feedback/')[1] || '');
    const d = docs[id];
    if (!d) return new Response('{}', { status: 404 });
    if ((init.method || 'GET') === 'PATCH') {
      const maschera = u.searchParams.getAll('updateMask.fieldPaths');
      const campi = JSON.parse(init.body).fields || {};
      scritture.push({ id, maschera, campi });
      for (const p of maschera) applica(d.fields, p, campi);
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(d), { status: 200 });
  };
  try { return await fn(scritture); } finally { globalThis.fetch = vero; globalThis.SN_FEEDBACK_ENC_ENABLED = cifra; }
}

const stato = (d) => d.fields.status.stringValue;
const parti = (d) => partiDaCampi(d.fields);
// registraParte firma l'ora vera: qui conta che la parte del server ci sia.
const conServer = (d) => {
  const { server, ...resto } = parti(d);
  assert.ok(server > 0, 'manca la parte del server');
  return resto;
};

// Quello che scrive il server quando fonde la parte dell'app (ownerMerge, in filo-security): la parte, campo per campo.
function fondeLApp(d, { ramo, at, chiude }) {
  applica(d.fields, 'localMerges.app', { localMerges: { mapValue: { fields: { app: valore(at) } } } });
  applica(d.fields, 'localMerges.ramo', { localMerges: { mapValue: { fields: { ramo: valore(ramo) } } } });
  if (chiude) Object.assign(d.fields, { status: { stringValue: 'done' }, statusPublic: { stringValue: 'closed' } });
}

async function serverFondi(argv, { ramiAperti = [] } = {}) {
  const righe = [];
  const lanci = [];
  const k = await esegui(argv, {
    env: {}, bearer: 'finto', base: FIRESTORE_BASE, funzioni: '/srv/functions',
    log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)),
    lancia: (_c, args) => { lanci.push(args); return 0; },
    punta: () => 'a'.repeat(40), ramiAperti: () => ramiAperti, ora: () => ORA, verdetto: () => null,
    fissa: (_c, ramo) => ({ ok: true, ramo, togli: () => ({ ok: true }) }),
    lavoroDelRamo: async () => ({ ok: true, registro: false, lavoroFidato: false, attesa: '', motivo: '' }),
    puntaRamo: () => 'c'.repeat(40), allinea: () => {}, deployDaGitHub: () => false,
    registraMain: async () => ({ outcome: 'registrato' }),
  });
  return { k, lanci, testo: righe.join('\n') };
}

const chiusa = (scritture) => scritture.some((s) => s.maschera.includes('resolvedInVersion'));

test('la regola: riapre solo chi porta una pratica chiusa (fatta o archiviata) in uno stato aperto', () => {
  assert.equal(FB.riapre('closed', 'todo'), true);
  assert.equal(FB.riapre('closed', 'working'), true);
  for (const [prima, dopo] of [['open', 'todo'], ['closed', 'done'], ['closed', 'archived'], [undefined, 'todo'], ['', 'todo']]) {
    assert.equal(FB.riapre(prima, dopo), false, `${prima} → ${dopo}`);
  }
});

test('updateStatus dell’app: col registro da togliere la maschera lo nomina e il corpo non lo porta; senza, non lo tocca', async () => {
  const vero = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, init = {}) => { chiamate.push({ url: String(url), corpo: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  try {
    await FB.updateStatus('p', { status: 'todo', localMerges: null }, { idToken: 't' });
    await FB.updateStatus('p', { status: 'todo' }, { idToken: 't' });
  } finally { globalThis.fetch = vero; }
  assert.match(chiamate[0].url, /updateMask\.fieldPaths=localMerges(&|$)/);
  assert.ok(!('localMerges' in chiamate[0].corpo.fields), 'il campo non va nel corpo: per Firestore vuol dire «via»');
  assert.doesNotMatch(chiamate[1].url, /localMerges/);
});

test('npm run feedback: riaprire (da fatta o da archiviata) svuota il registro; un passaggio fra stati aperti no', async () => {
  for (const da of ['done', 'archived']) {
    const docs = { p: pratica('p', { status: da, parti: { app: ORA - 30 * ORE, server: ORA - 29 * ORE, ramo: 'claude/x' } }) };
    await conRete(docs, async (scritture) => {
      const prova = await of.scrivi('p', 'todo', 'manca il caso Y', { ...OPTS, dryRun: true });
      assert.ok(prova.campi.includes('localMerges'), da);
      assert.match(of.campiLeggibili(prova.campi), /localMerges \(via: riaperta, le parti su main ripartono da zero\)/);
      assert.equal(scritture.length, 0);
      const r = await of.scrivi('p', 'todo', 'manca il caso Y', OPTS);
      assert.equal(r.ok, true, r.motivo);
      assert.equal(r.partiAzzerate, true);
      assert.deepEqual(parti(docs.p), {}, `${da}: il registro del giro chiuso è sparito`);
      assert.equal(stato(docs.p), 'todo');
    });
  }
  const aperta = { p: pratica('p', { status: 'todo', parti: { server: ORA - ORE, ramo: 'claude/x' } }) };
  await conRete(aperta, async () => {
    const r = await of.scrivi('p', 'working', '', { ...OPTS, attore: 'routine' });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.partiAzzerate, undefined);
    assert.deepEqual(parti(aperta.p), { server: ORA - ORE, ramo: 'claude/x' }, 'la pratica non era chiusa: le sue parti restano');
  });
  const senza = { p: pratica('p', { status: 'done' }) };
  await conRete(senza, async (scritture) => {
    await of.scrivi('p', 'todo', '', OPTS);
    assert.ok(!scritture[0].maschera.includes('localMerges'), 'niente registro, niente da togliere');
  });
});

test('caso 1: riaperta, arriva prima il seguito del server: non la richiude, e l’app la trova aperta', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { app: ORA - 30 * ORE, server: ORA - 29 * ORE, ramo: 'claude/x' } }) };
  await conRete(docs, async (scritture) => {
    assert.equal((await of.scrivi('p', 'todo', 'manca il caso Y', OPTS)).ok, true);
    const r = await serverFondi(['claude/x', '--feedback', 'p']);
    assert.equal(r.k, 0, r.testo);
    assert.equal(r.lanci.length, 1);
    assert.equal(chiusa(scritture), false, 'la parte dell’app della tornata prima non conta più');
    assert.match(r.testo, /resta aperta: manca la parte dell’app/);
    assert.equal(stato(docs.p), 'working');
    assert.deepEqual(conServer(docs.p), { ramo: 'claude/x' });
  });
});

test('caso 2: riaperta, arriva prima il seguito dell’app e la chiude: il seguito del server è l’ultima parte, non «già su main»', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { app: ORA - 30 * ORE, server: ORA - 29 * ORE, ramo: 'claude/x' } }) };
  await conRete(docs, async (scritture) => {
    assert.equal((await of.scrivi('p', 'todo', 'manca il caso Y', OPTS)).ok, true);
    fondeLApp(docs.p, { ramo: 'claude/x', at: ORA - ORE, chiude: true });
    const r = await serverFondi(['claude/x', '--feedback', 'p']);
    assert.equal(r.k, 0, r.testo);
    assert.equal(r.lanci.length, 1, 'il seguito del server arriva su main');
    assert.match(r.testo, /resta chiusa, con la nota di quest'ultima parte/);
    assert.equal(stato(docs.p), 'done');
    assert.deepEqual(conServer(docs.p), { app: ORA - ORE, ramo: 'claude/x' });
    assert.ok(scritture.length >= 2);
  });
});

test('caso 3: chiusa dall’app prima che il ramo del server esista, poi un seguito dell’app legato: il server la riapre', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { app: ORA - 3 * ORE, ramo: 'claude/x' } }) };
  await conRete(docs, async (scritture) => {
    const prova = await serverFondi(['claude/x', '--feedback', 'p', '--dry-run'], { ramiAperti: ['claude/x-seguito'] });
    assert.equal(prova.k, 0, prova.testo);
    assert.equal(scritture.length, 0, 'a vuoto non si scrive');
    assert.match(prova.testo, /claude\/x-seguito dell'app le è legato e non è su main: si riaprirebbe, andrebbe in lavorazione e, a fusione riuscita, resterebbe aperta/);

    const r = await serverFondi(['claude/x', '--feedback', 'p'], { ramiAperti: ['claude/x-seguito'] });
    assert.equal(r.k, 0, r.testo);
    assert.equal(r.lanci.length, 1);
    assert.match(r.testo, /Pratica #938 riaperta: l'aveva chiusa la fusione della parte dell’app/);
    assert.match(r.testo, /resta aperta: manca la parte dell’app, la chiude la fusione di claude\/x-seguito/);
    assert.equal(chiusa(scritture), false);
    assert.equal(stato(docs.p), 'working', 'il seguito dell’app la troverà aperta, e la chiuderà lui');
    assert.equal(docs.p.fields.statusPublic.stringValue, 'open');
    assert.deepEqual(conServer(docs.p), { ramo: 'claude/x' }, 'la parte dell’app del giro chiuso non conta più');
    assert.match(docs.p.fields.notes.stringValue, /Riaperta da server:fondi su claude\/x/);
  });
});

test('la parte tardiva senza rami dell’altra in arrivo resta come prima: la pratica non si riapre', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { app: ORA - 3 * ORE, ramo: 'claude/x' } }) };
  await conRete(docs, async () => {
    const r = await serverFondi(['claude/x', '--feedback', 'p']);
    assert.equal(r.k, 0, r.testo);
    assert.equal(stato(docs.p), 'done');
    assert.doesNotMatch(r.testo, /riaperta/);
  });
});

// La porta gemella: la parte dell'app arriva a pratica chiusa dalla parte del server (l'owner l'ha chiusa a mano).
test('finish: la parte dell’app tardiva con un ramo del server ancora fuori da main riapre la pratica prima della fusione', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { server: ORA - 2 * ORE, ramo: 'claude/x' } }) };
  const conBearer = {
    partiDellaPratica: (id) => of.partiDellaPratica(id, OPTS),
    scrivi: (id, to, nota) => of.scrivi(id, to, nota, OPTS),
    annotaPratica: (id, nota) => of.annotaPratica(id, nota, OPTS),
  };
  const inArrivo = [{ part: 'server', branch: 'claude/x' }];
  await conRete(docs, async (scritture) => {
    assert.equal(await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: [] }, { of: conBearer, ora: ORA }), '');
    assert.equal(scritture.length, 0, 'senza un ramo del server in arrivo non si tocca niente');
    const riga = await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: inArrivo }, { of: conBearer, ora: ORA });
    assert.match(riga, /pratica riaperta \(«In lavorazione»\): l'aveva chiusa la fusione della parte del server .* claude\/x del server non è su main/);
    assert.equal(stato(docs.p), 'working');
    assert.deepEqual(parti(docs.p), {});
    // La fusione dell'app (server) la trova aperta e, col ramo del server in arrivo, la lascia aperta segnando la sua parte.
    fondeLApp(docs.p, { ramo: 'claude/x', at: ORA, chiude: false });
    const r = await serverFondi(['claude/x', '--feedback', 'p']);
    assert.equal(r.k, 0, r.testo);
    assert.ok(chiusa(scritture), 'il seguito del server è l’ultima parte e la chiude');
    assert.match(r.testo, /Pratica #938 chiusa/);
  });
  // Già aperta, o chiusa dalla fusione di un altro lavoro: non si riapre niente, decide la fusione. Il seguito dello
  // stesso ramo a parti già passate ha la prova sua, più sotto.
  for (const d of [pratica('p', { status: 'working', parti: { server: ORA - ORE, ramo: 'claude/x' } }),
    pratica('p', { status: 'done', parti: { server: ORA - ORE, app: ORA - ORE, ramo: 'claude/altro' } })]) {
    await conRete({ p: d }, async (scritture) => {
      assert.equal(await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: inArrivo }, { of: conBearer, ora: ORA }), '');
      assert.equal(scritture.length, 0);
    });
  }
  const guasta = { partiDellaPratica: async () => { throw new Error('rete giù'); } };
  assert.match(await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: inArrivo }, { of: guasta, ora: ORA }), /non si legge \(rete giù\)/);
});

// Il terzo caso nell'ordine inverso: il seguito dell'app arriva prima del ramo del server, a pratica chiusa dalla
// prima fusione dell'app. Chi arriva e trova l'altra parte in arrivo riapre, anche se la sua era già passata.
test('finish: il seguito dell’app che arriva prima del server riapre la pratica chiusa dalla sua prima fusione', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { app: ORA - 3 * ORE, ramo: 'claude/x' } }) };
  const conBearer = {
    partiDellaPratica: (id) => of.partiDellaPratica(id, OPTS),
    scrivi: (id, to, nota) => of.scrivi(id, to, nota, OPTS),
    annotaPratica: (id, nota) => of.annotaPratica(id, nota, OPTS),
  };
  const inArrivo = [{ part: 'server', branch: 'claude/x' }];
  await conRete(docs, async (scritture) => {
    const riga = await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: inArrivo }, { of: conBearer, ora: ORA });
    assert.match(riga, /pratica riaperta \(«In lavorazione»\): l'aveva chiusa la fusione della parte dell’app .* claude\/x del server non è su main/);
    assert.equal(stato(docs.p), 'working');
    assert.deepEqual(parti(docs.p), {});
    fondeLApp(docs.p, { ramo: 'claude/x', at: ORA, chiude: false });
    const r = await serverFondi(['claude/x', '--feedback', 'p']);
    assert.equal(r.k, 0, r.testo);
    assert.ok(chiusa(scritture), 'il ramo del server è l’ultima parte e la chiude');
  });
  // Un seguito da un altro ramo, fuori tempo, o dopo un «stava tutto lì»: non è di questo lavoro, non si riapre.
  for (const p of [{ app: ORA - 3 * ORE, ramo: 'claude/altro' }, { app: ORA - 49 * ORE, ramo: 'claude/x' },
    { app: ORA - 3 * ORE, ramo: 'claude/x', solo: 'app' }]) {
    await conRete({ p: pratica('p', { status: 'done', parti: p }) }, async (scritture) => {
      assert.equal(await riapriPerIlServer({ id: 'p', ramo: 'claude/x', pendingParts: inArrivo }, { of: conBearer, ora: ORA }), '');
      assert.equal(scritture.length, 0, JSON.stringify(p));
    });
  }
});

test('server:fondi: il seguito del server, a pratica chiusa con le due parti già passate, riapre se dell’app arriva ancora un ramo', async () => {
  const docs = { p: pratica('p', { status: 'done', parti: { app: ORA - 5 * ORE, server: ORA - 3 * ORE, ramo: 'claude/x' } }) };
  await conRete(docs, async (scritture) => {
    const r = await serverFondi(['claude/x', '--feedback', 'p'], { ramiAperti: ['claude/x'] });
    assert.equal(r.k, 0, r.testo);
    assert.equal(r.lanci.length, 1);
    assert.match(r.testo, /Pratica #938 riaperta: l'aveva chiusa la fusione della parte del server/);
    assert.equal(chiusa(scritture), false);
    assert.equal(stato(docs.p), 'working');
    assert.deepEqual(conServer(docs.p), { ramo: 'claude/x' });
  });
  // Senza rami dell'app in arrivo resta il rifiuto di prima: la parte del server è già su main.
  const ferma = { p: pratica('p', { status: 'done', parti: { app: ORA - 5 * ORE, server: ORA - 3 * ORE, ramo: 'claude/x' } }) };
  await conRete(ferma, async (scritture) => {
    const r = await serverFondi(['claude/x', '--feedback', 'p']);
    assert.equal(r.k, 3, r.testo);
    assert.match(r.testo, /già su main/);
    assert.equal(scritture.length, 0);
  });
});
