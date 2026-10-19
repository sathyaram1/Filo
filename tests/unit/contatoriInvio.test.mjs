// I contatori giornalieri (#969), la spedizione: con un fetch finto, un documento al giorno con la forma giusta; in
// incognito e a contatori spenti nessuno. Il servizio vero (src/main/services/contatori.js) con disco e orologio finti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'modelUsage.js'));
require(join(ROOT, 'src', 'shared', 'wallet.js'));
require(join(ROOT, 'src', 'shared', 'contatoriGiornalieri.js'));
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const C = globalThis.SN_CONTATORI;
const A = globalThis.SN_CONST.ACTIONS;

const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const GIORNO = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 15, 9, 0, 0).getTime();
const attendi = () => new Promise((r) => setImmediate(r));

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ accesi = true, incognito = false, finestra = true, risposta = 200 } = {}) {
  const disco = new Map();
  const inviati = [];
  const b = {
    t: T0, accesi, incognito, finestra, risposta, disco, inviati, n: 0,
  };
  b.s = Servizio.crea({
    contatori: C,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => b.incognito,
    runNormale: (fn) => fn(),
    finestraNormale: () => b.finestra,
    adesso: () => b.t,
    versione: () => '0.2.243',
    piattaforma: 'darwin',
    esclusi: async () => ['abcdef0123456789'],
    casuale: () => `${'9'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    fetch: async (url, opt) => {
      if (b.risposta === 'rete') throw new TypeError('fetch failed');
      inviati.push({ url, opt, doc: Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)])) });
      return { ok: b.risposta >= 200 && b.risposta < 300, status: b.risposta, json: async () => ({}) };
    },
    log: () => {},
  });
  return b;
}

async function usa(b, action, { attesa = 0, errore = null, ok = true } = {}) {
  const h = b.s.apri(action);
  b.t += attesa;
  if (ok) h.visto();
  if (errore) h.errore(errore, { modello: 'deepseek/deepseek-v4-pro', host: 'DeepInfra' });
  h.fine(ok);
  await attendi(); await attendi();
}

test('un documento al giorno, con la forma giusta e niente altro', async () => {
  const b = banco();
  await usa(b, A.FILO_CHAT, { attesa: 1500 });
  await usa(b, A.FILO_CHAT, { attesa: 400 });
  await usa(b, A.EXPLAIN, { errore: Object.assign(new Error('OpenRouter 402'), { status: 402 }), ok: false });
  assert.equal(await b.s.controlla(), 'niente', 'il giorno in corso non parte');
  assert.equal(b.inviati.length, 0);

  b.t += GIORNO;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.inviati.length, 1);
  const [{ url, opt, doc }] = b.inviati;
  assert.equal(opt.method, 'POST');
  assert.ok(!opt.headers.Authorization, 'si spedisce senza login, come i feedback');
  const id = `99999999999999999901_2026-10-15`;
  assert.equal(url, `${BASE}/${C.COLLEZIONE}?documentId=${id}&key=K`);
  assert.deepEqual(doc, {
    v: 1, pseudonimo: '99999999999999999901', giorno: '2026-10-15', mese: '2026-10', app: '0.2.243', os: 'mac',
    uso: { 'filo-chat': '2;1,0,1,0,0,0,0', explain: '1;0,0,0,0,0,0,0' },
    errori: { explain: 'deepseek/deepseek-v4-pro|DeepInfra|crediti|1' },
  });
  assert.equal(C.valida(doc).ok, true);

  // Lo stesso giorno non riparte, e il giorno dopo parte il giorno di Filo aperto, con lo stesso pseudonimo del mese.
  assert.equal(await b.s.controlla(), 'niente');
  b.t += GIORNO;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.inviati.length, 2);
  assert.equal(b.inviati[1].doc.giorno, '2026-10-16');
  assert.equal(b.inviati[1].doc.pseudonimo, '99999999999999999901');
  assert.deepEqual(b.inviati[1].doc.uso, {});
});

test('un messaggio di chat coi suoi giri di strumenti è un uso, con l’attesa da quando è partito', async () => {
  const b = banco();
  await b.s.unUso(A.FILO_CHAT, async () => {
    b.t += 700; // la preparazione del contesto: anche questa è attesa
    const primo = b.s.apri(A.FILO_CHAT);
    b.t += 1000; primo.errore(Object.assign(new Error('x'), { status: 500 }), { modello: 'a/b', host: 'H' });
    b.t += 300; primo.visto(); primo.fine(true);
    const secondo = b.s.apri(A.FILO_CHAT);
    b.t += 5000; secondo.visto(); secondo.fine(true);
    const altra = b.s.apri(A.DESCRIBE_IMAGE); // un'altra funzione dentro la chat conta da sé
    b.t += 100; altra.fine(true);
  });
  await attendi(); await attendi();
  b.t += GIORNO;
  await b.s.controlla();
  const { doc } = b.inviati[0];
  assert.deepEqual(C.leggiUso(doc.uso['filo-chat']), { n: 1, fasce: { s2: 1 } });
  assert.deepEqual(C.leggiUso(doc.uso['describe-image']), { n: 1, fasce: { ms500: 1 } });
  assert.deepEqual(C.leggiErrori(doc.errori['filo-chat']), [{ modello: 'a/b', host: 'H', tipo: 'fornitore', n: 1 }]);
});

test('in incognito non si conta niente e non parte nessun documento', async () => {
  const b = banco({ incognito: true, finestra: false });
  await usa(b, A.FILO_CHAT, { attesa: 900 });
  await b.s.unUso(A.FILO_CHAT, async () => { b.s.apri(A.FILO_CHAT).fine(true); });
  await b.s.controlla();
  b.t += GIORNO;
  await b.s.controlla();
  b.incognito = false;
  b.t += GIORNO;
  await b.s.controlla();
  assert.equal(b.inviati.length, 0, JSON.stringify(b.inviati.map((x) => x.doc)));
});

test('con una finestra normale aperta accanto, quello che si fa in incognito resta fuori dai numeri', async () => {
  const b = banco({ incognito: true, finestra: true });
  await usa(b, A.TRANSLATE_PAGE, { attesa: 900 });
  b.incognito = false;
  await usa(b, A.HELP, { attesa: 100 });
  b.t += GIORNO;
  await b.s.controlla();
  assert.deepEqual(b.inviati.map((x) => Object.keys(x.doc.uso)), [['help']]);
});

test('a contatori spenti non si conta niente e non parte niente, e quello che c’era si butta', async () => {
  const b = banco();
  await usa(b, A.FILO_CHAT, { attesa: 900 });
  b.accesi = false;
  b.s.seguiImpostazioni({ contatori: { attivi: false } });
  await attendi(); await attendi();
  await usa(b, A.EXPLAIN, { attesa: 300 });
  b.t += GIORNO;
  assert.equal(await b.s.controlla(), 'spenti');
  b.t += GIORNO;
  await b.s.controlla();
  assert.equal(b.inviati.length, 0);
  const salvato = b.disco.get(Servizio.CHIAVE);
  assert.deepEqual(salvato.giorni, {}, 'spenti, i giorni raccolti prima non restano ad aspettare');
  assert.deepEqual(salvato.pseudonimi, {});

  // Riaccesi, si riparte da zero: il giorno di prima non torna.
  b.accesi = true;
  await usa(b, A.HELP, { attesa: 100 });
  b.t += GIORNO;
  await b.s.controlla();
  assert.equal(b.inviati.length, 1);
  assert.deepEqual(Object.keys(b.inviati[0].doc.uso), ['help']);
});

test('un invio fallito riprova il giorno dopo, e al ritorno partono tutti i giorni rimasti, dal più vecchio', async () => {
  const b = banco({ risposta: 503 });
  for (let d = 0; d < 3; d++) {
    await usa(b, A.TRANSLATE_PAGE, { attesa: 2500 });
    b.t += GIORNO;
    assert.equal(await b.s.controlla(), 'fallito');
    assert.equal(await b.s.controlla(), 'rimandato', 'col server giù, nello stesso giorno non si bussa di nuovo');
  }
  assert.equal(b.inviati.length, 3, 'un tentativo al giorno');
  b.risposta = 'rete';
  b.t += GIORNO;
  assert.equal(await b.s.controlla(), 'fallito');
  b.risposta = 200;
  b.inviati.length = 0;
  b.t += GIORNO;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.deepEqual(b.inviati.map((x) => x.doc.giorno), ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
  assert.equal(C.leggiUso(b.inviati[0].doc.uso['translate-page']).n, 1);
});

test('un giorno che il server rifiuta non ferma quelli dopo: si riprova domani, e parte quando le regole lo accettano', async () => {
  const b = banco();
  const rifiuta = new Set(['explain-deep']);
  // Il server finto rifiuta, come le regole non ancora ripubblicate, il giorno che porta una funzione che non conosce.
  const inviati = b.inviati;
  b.s = Servizio.crea({
    contatori: C,
    storage: { getRaw: async (k, d) => (b.disco.has(k) ? JSON.parse(JSON.stringify(b.disco.get(k))) : d), setRaw: async (k, v) => { b.disco.set(k, JSON.parse(JSON.stringify(v))); } },
    impostazioni: async () => ({ contatori: { attivi: true } }), inIncognito: () => false, runNormale: (fn) => fn(),
    finestraNormale: () => true, adesso: () => b.t, versione: () => '0.2.243', piattaforma: 'win32',
    casuale: () => 'a'.repeat(20), rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }), log: () => {},
    fetch: async (url, opt) => {
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      const no = Object.keys(doc.uso).some((f) => rifiuta.has(f));
      inviati.push({ doc, rifiutato: no });
      return { ok: !no, status: no ? 403 : 200, json: async () => ({}) };
    },
  });
  await usa(b, A.EXPLAIN_DEEP); b.t += GIORNO;
  await usa(b, A.EXPLAIN); b.t += GIORNO;
  await b.s.controlla();
  assert.deepEqual(inviati.map((x) => [x.doc.giorno, x.rifiutato]), [['2026-10-15', true], ['2026-10-16', false]]);
  inviati.length = 0;
  await b.s.controlla();
  assert.deepEqual(inviati, [], 'il giorno rifiutato non si ripropone nello stesso giorno');
  rifiuta.clear(); // le regole ripubblicate
  b.t += GIORNO;
  await b.s.controlla();
  assert.deepEqual(inviati.map((x) => x.doc.giorno), ['2026-10-15', '2026-10-17']);
  assert.deepEqual(b.disco.get(Servizio.CHIAVE).rifiutati, {});
});

test('un anticipo o un pezzo di un uso conta i guasti ma non un uso; la cache e la pagina contano l’uso', async () => {
  const b = banco();
  // La spiegazione preparata alla selezione e mai aperta: un guasto sì, un uso no.
  await b.s.parteDiUnUso(A.EXPLAIN, async () => {
    const h = b.s.apri(A.EXPLAIN);
    h.errore(Object.assign(new Error('giù'), { status: 503 }), { modello: 'a/b', host: 'H' });
    h.fine(false);
  });
  await b.s.parteDiUnUso(A.EXPLAIN, async () => { const h = b.s.apri(A.EXPLAIN); b.t += 900; h.visto(); h.fine(true); });
  // Aperta poi dalla persona: l'uso lo conta la pagina, con l'attesa che ha visto lei.
  assert.equal(b.s.usoDallaPagina(A.EXPLAIN, 1500), true);
  assert.equal(b.s.usoDallaPagina('una funzione inventata', 10), false);
  // Una risposta dalla cache è un uso senza attesa; dentro un uso aperto non ne conta un secondo.
  b.s.servitaDaCache(A.EXPLAIN);
  await b.s.unUso(A.FILO_CHAT, async () => { b.s.servitaDaCache(A.FILO_CHAT); });
  b.incognito = true;
  assert.equal(b.s.usoDallaPagina(A.EXPLAIN, 10), false, 'in incognito la pagina non conta');
  b.s.servitaDaCache(A.EXPLAIN);
  b.incognito = false;
  await attendi(); await attendi();
  b.t += GIORNO;
  await b.s.controlla();
  const { doc } = b.inviati[0];
  assert.deepEqual(C.leggiUso(doc.uso.explain), { n: 2, fasce: { ms500: 1, s2: 1 } });
  assert.deepEqual(C.leggiUso(doc.uso['filo-chat']), { n: 1, fasce: { ms500: 1 } });
  assert.deepEqual(C.leggiErrori(doc.errori.explain), [{ modello: 'a/b', host: 'H', tipo: 'fornitore', n: 1 }]);
});

test('i giorni rimasti partono con un tetto, e il resto il giro dopo', async () => {
  const b = banco({ risposta: 503 });
  const giorni = C.TETTO_INVII_PER_GIRO + 4;
  for (let d = 0; d < giorni; d++) { await usa(b, A.HELP); b.t += GIORNO; }
  b.risposta = 200;
  b.inviati.length = 0;
  await b.s.controlla();
  assert.equal(b.inviati.length, C.TETTO_INVII_PER_GIRO);
  b.t += 60 * 60 * 1000;
  await b.s.controlla();
  assert.equal(b.inviati.length, giorni);
});

test('l’ultimo giorno del mese, spedito il mese dopo, porta lo pseudonimo del suo mese', async () => {
  const b = banco();
  b.t = new Date(2026, 9, 31, 22, 0, 0).getTime();
  await usa(b, A.HELP);
  b.t = new Date(2026, 10, 2, 9, 0, 0).getTime();
  await b.s.controlla();
  b.t += GIORNO;
  await b.s.controlla();
  const [ott, nov] = b.inviati.map((x) => x.doc);
  assert.equal(ott.giorno, '2026-10-31');
  assert.equal(nov.giorno, '2026-11-02');
  assert.notEqual(ott.pseudonimo, nov.pseudonimo, 'al mese nuovo uno pseudonimo nuovo');
  assert.notEqual(nov.pseudonimo, 'abcdef0123456789');
});

test('il cancello conta ogni chiamata e non si ferma se il contatore si rompe', async () => {
  const G = globalThis.SN_MODEL_GATE;
  const visti = [];
  const contatore = {
    apri: (action) => {
      const voce = { action, visti: 0, errori: [], fine: null };
      visti.push(voce);
      return { visto: () => { voce.visti += 1; }, errore: (e, x) => voce.errori.push({ e, x }), fine: (ok) => { voce.fine = ok; } };
    },
  };
  const gate = (c) => G.create({
    getSettings: async () => ({}), buildChain: () => [{ provider: 'p', model: 'm/a' }, { provider: 'p', model: 'm/b' }],
    modelFor: () => 'x', costs: { isOverLimit: async () => false, record: async () => 0 }, contatore: () => c,
  });
  globalThis.SN_PROVIDERS = {
    getProvider: () => ({}),
    streamCompleteWithFallback: async ({ onDelta, onTentativoFallito }) => {
      onTentativoFallito(Object.assign(new Error('giù'), { status: 503 }), { modello: 'm/a', host: 'H' });
      onDelta('ciao'); onDelta(' mondo');
      return { text: 'ciao mondo' };
    },
    completeWithFallback: async () => { throw Object.assign(new Error('OpenRouter 402'), { status: 402 }); },
  };
  await gate(contatore).stream({ action: A.FILO_CHAT, messages: [], onDelta: () => {} });
  await assert.rejects(gate(contatore).complete({ action: A.EXPLAIN, messages: [] }));
  assert.equal(visti[0].action, A.FILO_CHAT);
  assert.equal(visti[0].visti, 2);
  assert.equal(visti[0].errori[0].x.modello, 'm/a');
  assert.equal(visti[0].fine, true);
  assert.equal(visti[1].fine, false);
  const rotto = { apri: () => { throw new Error('rotto'); } };
  const r = await gate(rotto).stream({ action: A.FILO_CHAT, messages: [], onDelta: () => {} });
  assert.equal(r.text, 'ciao mondo');
  const metaRotto = { apri: () => ({ visto() { throw new Error('x'); }, errore() { throw new Error('x'); }, fine() { throw new Error('x'); } }) };
  assert.equal((await gate(metaRotto).stream({ action: A.FILO_CHAT, messages: [], onDelta: () => {} })).text, 'ciao mondo');
  delete globalThis.SN_PROVIDERS;
});

test('l’owner conta gli pseudonimi distinti, pagina dopo pagina, chiedendo solo lo pseudonimo', async () => {
  const chieste = [];
  const pagine = { giorno: [['a', 'b', 'a']], mese: [Array.from({ length: 1000 }, (_, i) => `p${i % 700}`), ['p1', 'nuovo']] };
  const s = Servizio.crea({
    contatori: C,
    storage: { getRaw: async (k, d) => d, setRaw: async () => {} },
    impostazioni: async () => ({}),
    inIncognito: () => false,
    runNormale: (fn) => fn(),
    adesso: () => new Date(2026, 10, 1, 10, 0, 0).getTime(),
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    fetch: async (url, opt) => {
      const q = JSON.parse(opt.body).structuredQuery;
      chieste.push({ url, auth: opt.headers.Authorization, q });
      const campo = q.where.fieldFilter.field.fieldPath;
      const pagina = pagine[campo][q.startAt ? 1 : 0] || [];
      const righe = pagina.map((p, i) => ({ document: { name: `${BASE}/${C.COLLEZIONE}/${campo}${q.startAt ? 'b' : 'a'}${i}`, fields: { pseudonimo: { stringValue: p } } } }));
      return { ok: true, status: 200, json: async () => (righe.length ? righe : [{ readTime: 'x' }]) };
    },
  });
  const r = await s.installazioni({ idToken: 'tok' });
  // Il primo del mese: «ieri» è l'ultimo giorno del mese prima, il mese in corso è quello nuovo.
  assert.deepEqual(r, { ieri: { giorno: '2026-10-31', n: 2, completo: true }, mese: { mese: '2026-11', n: 701, completo: true } });
  assert.ok(chieste.every((c) => c.url === `${BASE}:runQuery?key=K` && c.auth === 'Bearer tok'));
  assert.ok(chieste.every((c) => JSON.stringify(c.q.select) === JSON.stringify({ fields: [{ fieldPath: 'pseudonimo' }] })), 'si chiede solo lo pseudonimo');
  const seconda = chieste.find((c) => c.q.startAt);
  assert.equal(seconda.q.startAt.values[0].referenceValue, `${BASE}/${C.COLLEZIONE}/mesea999`);
  await assert.rejects(s.installazioni({}), /Sessione scaduta/);
});

test('a Filo si chiede a parole: «contatori» e i suoi sinonimi accendono e spengono l’interruttore, con conferma', () => {
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  const P = globalThis.SN_PREF;
  for (const chiave of ['contatori', 'contatori anonimi', 'telemetria', 'statistiche d\'uso']) {
    const r = P.buildPreferencePartial(chiave, 'no');
    assert.deepEqual(r && r.partial, { contatori: { attivi: false } }, chiave);
    assert.equal(r.costo, 1, 'spegnerli manda fuori meno: stringe (#1312)');
    assert.ok(r.risk);
  }
  assert.deepEqual(P.buildPreferencePartial('contatori', 'sì').partial, { contatori: { attivi: true } });
  assert.equal(P.buildPreferencePartial('contatori', 'sì').costo, 2, 'riaccenderli chiede un OK');
  assert.deepEqual(globalThis.SN_CONST.DEFAULT_SETTINGS.contatori, { attivi: true }, 'accesi di serie (D52)');
});
