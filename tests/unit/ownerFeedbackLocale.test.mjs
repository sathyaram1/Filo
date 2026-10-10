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
// Dal #1148 conta la fiducia, non la prova: le pratiche dell'owner e delle sessioni con la prova nascono (o la migrazione
// le fa) fidate. Le prove la dicono come la scriverebbe il server, salvo dove la passano loro.
function documento(id, f) {
  const fields = {};
  const proprie = /^(owner|local):/i.test(String(f.clientId || '')) && f.senderProof === 'admin';
  for (const [k, v] of Object.entries(proprie && !('fiducia' in f) ? { ...f, fiducia: 'fidato' } : f)) if (v !== undefined) fields[k] = campo(v);
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
    assert.deepEqual(Object.keys(patch[0].body.fields), ['updatedAt']);
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
    const r = await mod.praticaPerLaSessione('o2', { ...OPTS, allaChiusura: true });
    assert.equal(r.ok, true, r.motivo);
    assert.match(r.avviso, /solo in locale/, 'alla chiusura senza il segno si lega, ma L5 non si salta: lo dice');
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
    assert.deepEqual([r.ok, r.utente, r.routine], [false, false, true]);
    // #914: una routine che scopre il lavoro locale lo rimanda nei Ricevuti, dove l'owner lo approva (#913).
    assert.match(mod.rifiutoPratica('r1', r), /owner-feedback.mjs r1 --serve-locale/);
  });
});

// Il server rimette in coda un «In lavorazione» senza segno locale dopo un'ora: una routine rifarebbe il lavoro
// della sessione. Per cominciare, dove le routine la prendono, la pratica deve portare il segno.
test('all’avvio una pratica dell’owner senza segno locale, dove le routine la prendono, non si lega; nei Ricevuti e alla chiusura sì', async () => {
  for (const status of ['todo', 'working', 'revision_capability', 'revision_security']) {
    await conRete(documento('s1', { clientId: 'owner:me', senderProof: 'admin', status, statusPublic: 'open' }), async (patch) => {
      const r = await mod.praticaPerLaSessione('s1', OPTS);
      assert.deepEqual([r.ok, r.senzaSegno, r.utente], [false, true, false], status);
      assert.equal(patch.length, 0, status);
      const testo = mod.rifiutoPratica('s1', r);
      assert.match(testo, /owner-feedback\.mjs s1 --solo-locale/, `${status}: dice come mettere il segno`);
      assert.match(testo, /l’ha tolto lui/, `${status}: un segno tolto dall'owner non si rimette senza chiedere`);
      assert.doesNotMatch(testo, /--serve-locale|feedback:ripasso/, `${status}: non è un utente né senza prova`);
    });
  }
  await conRete(documento('s2', { clientId: 'owner:me', senderProof: 'admin', status: 'aligned', statusPublic: 'open' }), async () => {
    assert.equal((await mod.praticaPerLaSessione('s2', OPTS)).ok, true, 'nei Ricevuti le routine non la prendono');
  });
  await conRete(documento('s3', { clientId: 'owner:me', senderProof: 'admin', status: 'working', statusPublic: 'open' }), async () => {
    assert.equal((await mod.praticaPerLaSessione('s3', { ...OPTS, allaChiusura: true })).ok, true, 'a lavoro finito basta l’avviso');
  });
  const src = readFileSync(join(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  assert.match(src, /praticaPerLaSessione\(r\.id, \{ bearer, allaChiusura: true \}\)/, 'finish lega a lavoro finito');
  assert.doesNotMatch(readFileSync(join(ROOT, 'scripts', 'verify-local.mjs'), 'utf8'), /allaChiusura/, 'start chiede il segno');
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
    assert.doesNotMatch(mod.rifiutoPratica('f3', r), /--riconosci/, '#957: la prova a mano solo da Gestione');
    assert.match(mod.rifiutoPratica('f3', r), /in Gestione, col tasto «🙋 È mio»/);
    assert.doesNotMatch(mod.rifiutoPratica('f3', r), /feedback:ripasso/, '#912: il ripasso non dà la prova al solo nome');
  });
  const segno = { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1790000000000' } } } };
  const owner = documento('o3', { clientId: 'owner:me', senderProof: 'admin', status: 'todo', statusPublic: 'open', notes: '', localOnly: segno });
  await conRete(owner, async (patch) => {
    const r = await mod.scrivi('o3', 'working', 'lo prendo', { ...OPTS, attore: 'routine' });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(patch.length, 1);
  });
  // Senza il segno la presa in carico a mano si rifiuta come all'avvio della verifica: le routine la riprenderebbero.
  await conRete(documento('o4', { clientId: 'owner:me', senderProof: 'admin', status: 'todo', statusPublic: 'open', notes: '' }), async (patch) => {
    const r = await mod.scrivi('o4', 'working', 'lo prendo', { ...OPTS, attore: 'routine' });
    assert.deepEqual([r.ok, r.senzaSegno, patch.length], [false, true, 0], r.motivo);
    assert.match(mod.rifiutoPratica('o4', r), /--solo-locale/);
    const chiusa = await mod.scrivi('o4', 'done', 'fatto in locale', { ...OPTS, attore: 'routine', dryRun: true });
    assert.equal(chiusa.ok, true, `chiuderla a mano resta permesso: ${chiusa.motivo}`);
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

// #957: la prova data a mano salta L5 come il sì: solo «🙋 È mio» in Gestione. La riga di comando: lavoroLocaleApprovato.test.mjs.
test('--riconosci non c’è più: lo script non sa dare la prova del mittente', () => {
  assert.equal(mod.riconosciMittente, undefined);
});

// Giro 3 della verifica locale: la regola del lettore vale anche per chi dà fiducia (segno locale, prova del mittente).
test('segno locale e prova del mittente: rifiutati, senza scrivere, sui feedback che il lettore rifiuta come segnalati', async () => {
  const attacco = JSON.stringify({ verdicts: [{ judge: 'A', class: 'aligned' }, { judge: 'B', class: 'attack' }] });
  const pericoloso = JSON.stringify({ stage: 'L1', action: 'block_attack', l1Category: 'dangerous' });
  const casi = [
    ['segno, collegio con un attacco', 'segnaLocale', { clientId: 'local:claude', senderProof: 'admin', status: 'unlabeled', pipeline: attacco }],
    ['segno, fermato dal filtro', 'segnaLocale', { clientId: 'owner:me', senderProof: 'admin', status: 'unlabeled', pipeline: pericoloso }],
    ['segno, giudizio illeggibile', 'segnaLocale', { clientId: 'local:claude', senderProof: 'admin', status: 'unlabeled', pipeline: 'FENC1:non-si-apre' }],
  ];
  for (const [nome, fn, f] of casi) {
    await conReteScritture(documento('x1', { statusPublic: 'open', ...f }), async (scritte) => {
      const r = await mod[fn]('x1', true, OPTS);
      assert.equal(r.ok, false, nome);
      assert.match(r.motivo, /attacco|giudizio/, nome);
      assert.equal(scritte.length, 0, nome);
    });
  }
  // Un giudizio pulito nei Ricevuti non ferma niente.
  const pulito = JSON.stringify({ verdicts: [{ judge: 'A', class: 'aligned' }] });
  await conReteScritture(documento('x2', { clientId: 'local:claude', senderProof: 'admin', status: 'unlabeled', statusPublic: 'open', pipeline: pulito }), async () => {
    assert.equal((await mod.segnaLocale('x2', true, OPTS)).ok, true);
  });
});

// Giro 4 della verifica locale: un rifiuto propone solo strade che su quella pratica funzionano.
test('le strade proposte dal rifiuto non rifiutano a loro volta: niente Ricevuti a chi c’è già, niente prova su parola a un segnalato', async () => {
  const attacco = JSON.stringify({ verdicts: [{ judge: 'A', class: 'attack' }, { judge: 'B', class: 'attack' }, { judge: 'C', class: 'aligned' }] });
  const casi = [
    ['utente nei Ricevuti', { clientId: 'c-tester', status: 'unlabeled' }],
    ['utente in coda', { clientId: 'c-tester', status: 'todo' }],
    ['sessione senza prova, segnalata', { clientId: 'local:claude', status: 'unlabeled', pipeline: attacco }],
    ['sessione senza prova, pulita', { clientId: 'local:claude', status: 'aligned' }],
  ];
  for (const [nome, f] of casi) {
    const doc = documento('h1', { statusPublic: 'open', notes: '', ...f });
    const vicoli = [];
    await conReteScritture(doc, async () => {
      const r = await mod.segnaLocale('h1', true, OPTS);
      assert.equal(r.ok, false, nome);
      const testo = mod.rifiutoPratica('h1', r);
      if (testo.includes('--serve-locale')) {
        const s = await mod.serveLocale('h1', 'prova', { ...OPTS, dryRun: true });
        if (!s.ok) vicoli.push(`--serve-locale: ${s.motivo}`);
      }
      if (nome === 'utente in coda') assert.match(testo, /--serve-locale/, nome);
      assert.doesNotMatch(testo, /--riconosci/, nome);
      if (nome === 'sessione senza prova, pulita') assert.match(testo, /in Gestione, col tasto «🙋 È mio»/, nome);
      if (/Ricevuti/.test(nome) || /segnalata/.test(nome)) assert.match(testo, /owner/, `${nome}: dice chi decide`);
    });
    assert.deepEqual(vicoli, [], nome);
  }
});

// Giro 4 della verifica locale: la pratica racconta il lavoro, presa in carico e giri nella conversazione.
test('l’avvio della verifica prende in carico la pratica in coda e ci scrive il giro; fuori dal lavoro non la tocca', async () => {
  const base = {
    clientId: 'local:claude', senderProof: 'admin', statusPublic: 'open', notes: '',
    localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1790000000000' } } } },
  };
  await conRete(documento('p1', { ...base, status: 'todo' }), async (patch) => {
    const r = await mod.annotaPratica('p1', 'Verifica locale, giro 1: avviata.', OPTS);
    assert.deepEqual([r.ok, r.from, r.to], [true, 'todo', 'working'], r.motivo);
    assert.equal(patch.length, 1);
    assert.match(patch[0].url, /updateMask\.fieldPaths=status/);
    assert.match(patch[0].url, /updateMask\.fieldPaths=notes/);
  });
  await conRete(documento('p2', { ...base, status: 'working' }), async (patch) => {
    const r = await mod.annotaPratica('p2', 'Verifica locale, giro 2: avviata.', OPTS);
    assert.deepEqual([r.ok, r.from, r.to], [true, 'working', 'working'], r.motivo);
    assert.equal(patch.length, 1);
  });
  for (const status of ['design', 'unlabeled', 'done', 'archived']) {
    await conRete(documento('p3', { ...base, status }), async (patch) => {
      const r = await mod.annotaPratica('p3', 'x', OPTS);
      assert.equal(r.ok, false, status);
      assert.equal(patch.length, 0, status);
    });
  }
  // Un utente non si prende in carico nemmeno da qui.
  await conRete(documento('p4', { clientId: 'c-tester', statusPublic: 'open', notes: '', status: 'todo' }), async (patch) => {
    assert.equal((await mod.annotaPratica('p4', 'x', OPTS)).ok, false);
    assert.equal(patch.length, 0);
  });
});

test('--non-locale su un lavoro locale chiuso: toglie il segno, lo dice, e non cancella la scheda della bacheca', async () => {
  const doc = documento('c1', {
    clientId: 'local:claude', senderProof: 'admin', status: 'done', statusPublic: 'closed',
    localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1790000000000' } } } },
  });
  const scritture = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const metodo = opts.method || 'GET';
    if (metodo !== 'GET') { scritture.push(`${metodo} ${url}`); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
    return { ok: true, status: 200, json: async () => doc, text: async () => '' };
  };
  try {
    const r = await mod.segnaLocale('c1', false, OPTS);
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.chiusa, true);
    assert.equal(scritture.length, 1, scritture.join('\n'));
    assert.match(scritture[0], /^PATCH .*\/feedback\/c1\?updateMask\.fieldPaths=localOnly&updateMask\.fieldPaths=updatedAt$/);
  } finally { globalThis.fetch = vero; }
});

// #913: il Firestore vero risponde coi soli campi chiesti. Un passaggio che non chiede il sì dell'owner vede un utente.
test('approvato come lavoro locale: i passaggi di npm run feedback e la presa in carico lo accettano, con la maschera vera', async () => {
  const si = { mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { integerValue: '1790000000000' } } } };
  const docs = {
    inCoda: documento('inCoda', { clientId: 'utente-7', status: 'todo', statusPublic: 'open', localOnly: si, localApproval: si }),
    inLavoro: documento('inLavoro', { clientId: 'utente-7', status: 'working', statusPublic: 'open', localOnly: si, localApproval: si }),
    senzaSi: documento('senzaSi', { clientId: 'utente-7', status: 'todo', statusPublic: 'open', localOnly: si }),
  };
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const doc = docs[decodeURIComponent(u.pathname.split('/').pop())];
    if ((opts.method || 'GET') !== 'GET') return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    const maschera = u.searchParams.getAll('mask.fieldPaths');
    const fields = maschera.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => maschera.includes(k))) : doc.fields;
    return { ok: true, status: 200, json: async () => ({ name: doc.name, fields }), text: async () => '' };
  };
  try {
    const o = { ...OPTS, dryRun: true };
    for (const [id, to, attore] of [['inCoda', 'working', 'routine'], ['inLavoro', 'revision_capability', 'routine'], ['inLavoro', 'done', 'routine']]) {
      const r = await mod.scrivi(id, to, '', { ...o, attore });
      assert.equal(r.ok, true, `${id} → ${to}: ${r.motivo}`);
    }
    const presa = await mod.annotaPratica('inCoda', '', o);
    assert.equal(presa.ok, true, presa.motivo);
    assert.equal(presa.to, 'working');
    const rifiuto = await mod.scrivi('senzaSi', 'working', '', { ...o, attore: 'routine' });
    assert.equal(rifiuto.ok, false);
    assert.equal(rifiuto.utente, true);
  } finally { globalThis.fetch = vero; }
});
