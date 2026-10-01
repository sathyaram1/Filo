// Lo script dell'owner nelle mani di una sessione locale (#908): il segno «solo in
// locale» solo su pratiche dell'owner o di una sessione con la prova, mai su un
// utente (che torna nei Ricevuti), e nessuna partenza dai Ricevuti. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);

const campo = (v) => (typeof v === 'string' ? { stringValue: v } : v);
function documento(id, f) {
  const fields = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined) fields[k] = campo(v);
  return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields };
}

/** fetch finto: le GET rendono `doc`, le PATCH si registrano e rispondono ok. */
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

test('--solo-locale su una pratica di una sessione con la prova: scrive { by, at } in millisecondi', async () => {
  const doc = documento('abc', { clientId: 'local:claude', senderProof: 'admin', status: 'todo', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('abc', true, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
    assert.match(patch[0].url, /updateMask\.fieldPaths=localOnly/);
    const lo = patch[0].body.fields.localOnly.mapValue.fields;
    assert.ok(lo.by.stringValue);
    assert.match(lo.at.integerValue, /^\d{13}$/);
  });
});

test('--solo-locale su un utente: rifiutato senza scrivere, e la risposta dice che è un utente', async () => {
  const doc = documento('u1', { clientId: 'c-sconosciuto', status: 'todo', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('u1', true, OPTS);
    assert.equal(r.ok, false);
    assert.equal(r.utente, true);
    assert.equal(patch.length, 0);
  });
});

test('--solo-locale su un falso local: (senza prova) vale come un utente', async () => {
  const doc = documento('f1', { clientId: 'local:claude', status: 'todo', statusPublic: 'open' });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('f1', true, OPTS);
    assert.deepEqual([r.ok, r.utente], [false, true]);
    assert.equal(patch.length, 0);
  });
});

test('--non-locale toglie il segno: maschera sul campo, nessun valore', async () => {
  const doc = documento('abc', {
    clientId: 'owner:me', senderProof: 'admin', status: 'working', statusPublic: 'open',
    localOnly: { mapValue: { fields: { by: { stringValue: 'o@x' }, at: { integerValue: '1790000000000' } } } },
  });
  await conRete(doc, async (patch) => {
    const r = await mod.segnaLocale('abc', false, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
    assert.deepEqual(patch[0].body.fields, {});
  });
});

test('nessuna partenza dai Ricevuti né dalle conferme: rifiuto prima di scrivere', async () => {
  for (const from of ['unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned', 'attack_confirmed']) {
    assert.ok(mod.partenzaVietata(from), from);
    const doc = documento('r1', { status: from, notes: '' });
    await conRete(doc, async (patch) => {
      const r = await mod.scrivi('r1', 'todo', 'nota', OPTS);
      assert.equal(r.ok, false, from);
      assert.match(r.motivo, /Ricevuti|conferma/);
      assert.equal(patch.length, 0, from);
    });
  }
  for (const from of ['todo', 'working', 'done', 'archived']) assert.equal(mod.partenzaVietata(from), '', from);
});

test('--serve-locale: il feedback di un utente torna nei Ricevuti, design, motivo locale', async () => {
  const doc = documento('u2', { clientId: 'c-utente', status: 'todo', statusPublic: 'open', notes: '' });
  await conRete(doc, async (patch) => {
    const r = await mod.serveLocale('u2', 'tocca le chiavi', { ...OPTS, dryRun: true });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual([r.from, r.to], ['todo', 'design']);
    assert.ok(r.campi.includes('statusReason'));
    assert.equal(patch.length, 0, 'prova a vuoto');
  });
  // Sul serio: la nota lo dice, il motivo è `locale`.
  await conRete(doc, async (patch) => {
    const r = await mod.serveLocale('u2', 'tocca le chiavi', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
    assert.equal(patch[0].body.fields.statusReason.stringValue, 'locale');
    assert.equal(patch[0].body.fields.statusPublic.stringValue, 'open');
  });
});

test('--serve-locale non serve sulle pratiche proprie, né su quelle già nei Ricevuti', async () => {
  await conRete(documento('o1', { clientId: 'owner:me', senderProof: 'admin', status: 'todo' }), async (patch) => {
    const r = await mod.serveLocale('o1', '', OPTS);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /--solo-locale/);
    assert.equal(patch.length, 0);
  });
  await conRete(documento('u3', { clientId: 'c', status: 'design' }), async (patch) => {
    const r = await mod.serveLocale('u3', '', OPTS);
    assert.equal(r.ok, false);
    assert.equal(patch.length, 0);
  });
});

test('--solo-locale su una pratica che una routine sta lavorando (battito fresco): rifiutato, niente scritto', async () => {
  const dueMinutiFa = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const doc = documento('w1', {
    clientId: 'owner:me', senderProof: 'admin', status: 'working', statusPublic: 'open', workingSince: dueMinutiFa, beatAt: dueMinutiFa,
  });
  const maschere = [];
  await conRete(doc, async (patch) => {
    const finto = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { maschere.push(String(url)); return finto(url, opts); };
    try {
      const r = await mod.segnaLocale('w1', true, OPTS);
      assert.equal(r.ok, false);
      assert.match(r.motivo, /routine la sta lavorando/);
      assert.equal(patch.length, 0);
    } finally { globalThis.fetch = finto; }
  });
  assert.match(maschere[0], /mask\.fieldPaths=beatAt/, 'il battito si chiede al documento');
  assert.match(maschere[0], /mask\.fieldPaths=workingSince/);
});

test('legare un lavoro locale a una pratica: sì a owner e sessioni con la prova, no a un utente (con la strada per i Ricevuti)', async () => {
  await conRete(documento('o1', { clientId: 'local:claude', senderProof: 'admin', status: 'working', statusPublic: 'open', localOnly: { mapValue: { fields: { by: { stringValue: 'o@x' }, at: { integerValue: '1790000000000' } } } } }), async () => {
    const r = await mod.praticaPerLaSessione('o1', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.avviso, '', 'pratica completa: niente da avvisare');
  });
  await conRete(documento('o2', { clientId: 'owner:me', senderProof: 'admin', status: 'todo', statusPublic: 'open' }), async () => {
    const r = await mod.praticaPerLaSessione('o2', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.match(r.avviso, /solo in locale/, 'senza il segno si lavora, ma L5 non si salta: lo dice');
  });
  for (const [id, campi] of [
    ['u850', { clientId: 'c-tester', status: 'todo', statusPublic: 'open' }],
    ['f850', { clientId: 'local:claude', status: 'todo', statusPublic: 'open' }],
  ]) {
    await conRete(documento(id, campi), async (patch) => {
      const r = await mod.praticaPerLaSessione(id, OPTS);
      assert.deepEqual([r.ok, r.utente], [false, true], id);
      assert.equal(patch.length, 0);
      const testo = mod.rifiutoPratica(id, r);
      assert.match(testo, /^RIFIUTATO: /);
      assert.match(testo, new RegExp(`owner-feedback\.mjs ${id} --serve-locale`));
    });
  }
  await conRete(documento('r1', { clientId: 'routine:worker', senderProof: 'server', status: 'todo' }), async () => {
    const r = await mod.praticaPerLaSessione('r1', OPTS);
    assert.deepEqual([r.ok, r.utente], [false, false]);
    assert.doesNotMatch(mod.rifiutoPratica('r1', r), /--serve-locale/);
  });
});

test('verify-local start --feedback e finish --feedback passano dallo stesso controllo del mittente', () => {
  for (const f of ['verify-local.mjs', 'finish-local.mjs']) {
    const src = readFileSync(join(ROOT, 'scripts', f), 'utf8');
    assert.match(src, /praticaPerLaSessione\(r\.id/, `${f}: la pratica si controlla prima di legarla`);
    assert.match(src, /rifiutoPratica\(r\.id, lavorabile\)/, `${f}: il rifiuto propone i Ricevuti`);
  }
});

test('negli stati del lavoro una sessione porta solo pratiche sue o dell’owner, non quelle di un utente', async () => {
  const utente = documento('u3', { clientId: 'c-utente', status: 'todo', statusPublic: 'open', notes: '' });
  for (const [to, attore] of [['working', 'routine'], ['revision_capability', 'routine'], ['done', 'routine']]) {
    await conRete(utente, async (patch) => {
      const r = await mod.scrivi('u3', to, 'lavorato in locale', { ...OPTS, attore });
      assert.equal(r.ok, false, `todo → ${to} su un utente`);
      assert.equal(r.utente, true);
      assert.equal(patch.length, 0);
      assert.match(mod.rifiutoPratica('u3', r), /--serve-locale/);
    });
  }
  const falso = documento('f3', { clientId: 'local:claude', status: 'working', statusPublic: 'open', notes: '' });
  await conRete(falso, async (patch) => {
    const r = await mod.scrivi('f3', 'done', 'fatto', { ...OPTS, attore: 'routine' });
    assert.deepEqual([r.ok, r.senzaProva, patch.length], [false, true, 0]);
    assert.match(mod.rifiutoPratica('f3', r), /feedback:ripasso/);
  });
  const owner = documento('o3', { clientId: 'owner:me', senderProof: 'admin', status: 'todo', statusPublic: 'open', notes: '' });
  await conRete(owner, async (patch) => {
    const r = await mod.scrivi('o3', 'working', 'lo prendo', { ...OPTS, attore: 'routine' });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
  });
  // Rimetterlo in coda non è lavorarlo: resta permesso anche su un utente.
  const preso = documento('u4', { clientId: 'c-utente', status: 'working', statusPublic: 'open', notes: '' });
  await conRete(preso, async (patch) => {
    const r = await mod.scrivi('u4', 'todo', 'torna alle routine', { ...OPTS, attore: 'routine' });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
  });
});

test('il feedback si indica col numero come negli strumenti fratelli: «910» non è «inesistente»', async () => {
  const viste = [];
  const fetchImpl = async (url, opts = {}) => {
    viste.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    const sub = (n) => ({ document: { name: `projects/p/databases/(default)/documents/feedback/id-${n}`, fields: { subSeq: { integerValue: String(n) } } } });
    return { ok: true, status: 200, json: async () => [sub(0), sub(1)] };
  };
  for (const [rif, id] of [['910', 'id-0'], ['#910', 'id-0'], ['910.1', 'id-1']]) {
    const r = await mod.idDelFeedback(rif, { bearer: 'x', base: 'https://finto', fetchImpl });
    assert.deepEqual(r, { ok: true, id }, rif);
  }
  assert.ok(viste.every((v) => v.url.endsWith(':runQuery') && v.body.structuredQuery.where.fieldFilter.value.integerValue === '910'));
  // Un id passa com'è, senza leggere niente.
  viste.length = 0;
  assert.deepEqual(await mod.idDelFeedback('tbCrpSR6tmPomfASfVdD', { bearer: 'x', base: 'https://finto', fetchImpl }), { ok: true, id: 'tbCrpSR6tmPomfASfVdD' });
  assert.equal(viste.length, 0);
  const vuoto = async () => ({ ok: true, status: 200, json: async () => [] });
  const r = await mod.idDelFeedback('99999', { bearer: 'x', base: 'https://finto', fetchImpl: vuoto });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /#99999/);
});

/** fetch finto che registra metodo e indirizzo di ogni scrittura. */
async function conReteScritture(doc, fn) {
  const scritte = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const metodo = opts.method || 'GET';
    if (metodo !== 'GET') scritte.push({ metodo, url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try { return await fn(scritte); } finally { globalThis.fetch = vero; }
}

test('un lavoro locale già chiuso si segna e la sua scheda esce dalla bacheca pubblica', async () => {
  const doc = documento('c1', { clientId: 'local:claude', senderProof: 'admin', status: 'done', statusPublic: 'closed' });
  await conReteScritture(doc, async (scritte) => {
    const r = await mod.segnaLocale('c1', true, OPTS);
    assert.deepEqual([r.ok, r.chiusa, r.scheda], [true, true, ''], r.motivo);
    assert.deepEqual(scritte.map((s) => s.metodo), ['PATCH', 'DELETE']);
    assert.match(scritte[1].url, /\/feedback-public\/c1$/);
  });
  // Aperta: niente da togliere dalla bacheca.
  const aperta = documento('a1', { clientId: 'local:claude', senderProof: 'admin', status: 'todo', statusPublic: 'open' });
  await conReteScritture(aperta, async (scritte) => {
    assert.equal((await mod.segnaLocale('a1', true, OPTS)).ok, true);
    assert.deepEqual(scritte.map((s) => s.metodo), ['PATCH']);
  });
});

test('--riconosci: la prova la dà l’owner, solo sui prefissi suoi e delle sessioni senza prova', async () => {
  const senza = documento('s1', { clientId: 'local:claude', status: 'unlabeled', statusPublic: 'open' });
  await conReteScritture(senza, async (scritte) => {
    const r = await mod.riconosciMittente('s1', OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(scritte.length, 1);
    assert.match(scritte[0].url, /updateMask\.fieldPaths=senderProof$/);
    assert.deepEqual(scritte[0].body.fields, { senderProof: { stringValue: 'admin' } });
  });
  for (const [id, f] of [
    ['p1', { clientId: 'owner:me', senderProof: 'admin', status: 'todo' }],
    ['u1', { clientId: 'c-utente', status: 'todo' }],
    ['r1', { clientId: 'routine:residuo', status: 'unlabeled' }],
  ]) {
    await conReteScritture(documento(id, f), async (scritte) => {
      assert.equal((await mod.riconosciMittente(id, OPTS)).ok, false, id);
      assert.equal(scritte.length, 0, id);
    });
  }
});
