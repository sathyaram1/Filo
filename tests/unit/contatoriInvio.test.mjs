// I contatori anonimi (#969, #1461), la spedizione: con un fetch finto, un documento per ora con la forma giusta; in
// incognito e a contatori spenti nessuno. Il servizio vero (src/main/services/contatori.js) con disco e orologio finti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'actionTools', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const C = globalThis.SN_CONTATORI;
const A = globalThis.SN_CONST.ACTIONS;

const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const ORA = 60 * 60 * 1000;
const GIORNO = 24 * ORA;
const T0 = new Date(2026, 9, 15, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ accesi = true, incognito = false, finestra = true, risposta = 200, disco = new Map(), identita = 'token-anonimo' } = {}) {
  const inviati = [];
  // Le chiamate ai modelli (#1464) e le attività (#1467) di un'ora partono nella loro collezione: si contano a parte.
  const chiamate = [];
  const attivita = [];
  // `identita`: l'idToken dell'installazione, un errore se non si ottiene (offline, persa); `identitaChieste` le volte.
  const b = { t: T0, accesi, incognito, finestra, risposta, disco, inviati, chiamate, attivita, n: 0, identita, identitaChieste: 0 };
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
    idToken: async () => {
      b.identitaChieste += 1;
      if (b.identita instanceof Error) throw b.identita;
      return b.identita;
    },
    fetch: async (url, opt) => {
      if (b.risposta === 'rete') throw new TypeError('fetch failed');
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      (url.includes(`/${C.COLLEZIONE_CHIAMATE}?`) ? chiamate : url.includes(`/${C.COLLEZIONE_ATTIVITA}?`) ? attivita : inviati).push({ url, opt, doc });
      const st = typeof b.risposta === 'function' ? b.risposta(doc) : b.risposta;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
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
  await attendi();
}

const vuoti = { azioni: {}, impostazioni: {}, ricerche: {}, correttore: {}, conferme: {}, annullati: {}, anticipi: {}, chiedi: {}, erroriVisti: {}, intervista: {} };
// Le misure del sistema (#1466) di un'ora senza niente: la loro stringa vuota.
const vuotiSistema = { sistema: '' };

test('un documento per ora, con la forma giusta e niente altro; un giorno senza niente parte una volta, vuoto', async () => {
  const b = banco();
  await usa(b, A.FILO_CHAT, { attesa: 1500 });
  await usa(b, A.FILO_CHAT, { attesa: 400 });
  await usa(b, A.EXPLAIN, { errore: Object.assign(new Error('OpenRouter 402'), { status: 402 }), ok: false });
  assert.equal(await b.s.controlla(), 'niente', 'l’ora in corso non parte');
  assert.equal(b.inviati.length, 0);

  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.inviati.length, 1);
  const [{ url, opt, doc }] = b.inviati;
  assert.equal(opt.method, 'POST');
  assert.equal(opt.headers.Authorization, 'Bearer token-anonimo', 'si spedisce con l’identità anonima dell’installazione (#1547)');
  assert.equal(url, `${BASE}/${C.COLLEZIONE}?documentId=99999999999999999901_2026-10-15_09&key=K`);
  assert.deepEqual(doc, {
    v: C.VERSIONE, pseudonimo: '99999999999999999901', giorno: '2026-10-15', mese: '2026-10', ora: '09', app: '0.2.243', os: 'mac', primo: 'mese',
    uso: { 'filo-chat': '2;1,0,1,0,0,0,0;1,0,1,0,0,0,0;1', explain: '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0' },
    errori: { explain: 'deepseek/deepseek-v4-pro|DeepInfra|crediti|1' },
    ...vuoti,
    primeVolte: ['filo-chat', 'explain'],
    ...vuotiSistema,
  });
  assert.equal(C.valida(doc).ok, true);
  // Le chiamate ai modelli della stessa ora partono accanto, con lo stesso id (#1464): qui ogni uso è una chiamata.
  assert.equal(b.chiamate.length, 1);
  assert.equal(b.chiamate[0].url, `${BASE}/${C.COLLEZIONE_CHIAMATE}?documentId=99999999999999999901_2026-10-15_09&key=K`);
  assert.deepEqual(b.chiamate[0].doc, {
    v: 1, pseudonimo: '99999999999999999901', giorno: '2026-10-15', mese: '2026-10', ora: '09', app: '0.2.243', os: 'mac',
    contesto: {}, cache: {}, ragionamento: {}, uscita: {}, ripieghi: {}, spesa: {}, adattamenti: {},
    chiamate: { 'filo-chat': '2,0,0,0,0', explain: '1,0,0,0,0' },
  });
  assert.equal(C.validaChiamate(b.chiamate[0].doc).ok, true);

  // Le ore in cui Filo resta aperto senza niente non partono; il giorno dopo parte una volta sola, vuoto.
  for (let h = 0; h < 5; h++) { b.t += ORA; await b.s.controlla(); }
  assert.equal(b.inviati.length, 1);
  b.t = new Date(2026, 9, 16, 8, 30, 0).getTime();
  await b.s.controlla();
  for (let h = 0; h < 3; h++) { b.t += ORA; await b.s.controlla(); }
  assert.equal(b.inviati.length, 2);
  assert.deepEqual([b.inviati[1].doc.giorno, b.inviati[1].doc.ora], ['2026-10-16', '08']);
  assert.equal(b.inviati[1].doc.pseudonimo, '99999999999999999901', 'lo stesso pseudonimo dentro il mese');
  assert.deepEqual(b.inviati[1].doc.uso, {});
  assert.deepEqual(b.inviati[1].doc.primeVolte, []);
  assert.equal(b.inviati[1].doc.primo, 'giorno', 'il primo documento del giorno lo dice');
  await usa(b, A.HELP); b.t += ORA; await b.s.controlla();
  assert.equal(b.inviati[2].doc.primo, '', 'gli altri no');
});

test('un messaggio di chat coi suoi giri di strumenti è un uso, con le attese da quando è partito', async () => {
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
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  const { doc } = b.inviati[0];
  assert.deepEqual(C.leggiMisura(doc.uso['filo-chat']), { n: 1, visto: { s2: 1 }, fine: { s10: 1 }, ripetute: 0 });
  assert.deepEqual(C.leggiMisura(doc.uso['describe-image']), { n: 1, visto: { ms500: 1 }, fine: { ms500: 1 }, ripetute: 0 });
  assert.deepEqual(C.leggiErrori(doc.errori['filo-chat']), [{ modello: 'a/b', host: 'H', tipo: 'fornitore', n: 1 }]);
});

test('le chiamate di un uso (#1464): i numeri di ognuna subito, quante sono alla fine, la spesa chiesta dopo anche a uso chiuso', async () => {
  const b = banco();
  const servita = (h, ingresso, usd) => h.chiamata({
    modello: 'deepseek/deepseek-v4-pro', ingresso, cacheLetti: ingresso / 2, cacheDetta: true, ragionamento: 300, uscita: 200, fine: 'tool_calls',
    tentativo: 1, spesa: { usd, origine: 'router' },
  });
  let voce = null;
  await b.s.unUso(A.FILO_CHAT, async () => {
    const primo = b.s.apri(A.FILO_CHAT);
    servita(primo, 9000, 0.003); primo.fine(true);
    b.s.servitaDaCache(A.FILO_CHAT); // una risposta dalla cache non è una chiamata al modello
    const secondo = b.s.apri(A.FILO_CHAT);
    servita(secondo, 12000, 0.004); secondo.fine(true);
  });
  // La voce: una chiamata sola, il costo arriva dopo che è finita.
  voce = b.s.apri(A.TTS);
  voce.chiamata({ modello: 'openai/gpt-4o-mini-tts', ingresso: null, uscita: null, spesa: null });
  voce.fine(true);
  voce.tardiva('openai/gpt-4o-mini-tts', 0.0007);
  await b.s.adattamento(A.FILO_CHAT, 'deepseek/deepseek-v4-pro', 'contesto_stretto');
  assert.equal(b.s.adattamento(A.FILO_CHAT, 'deepseek/deepseek-v4-pro', 'un tipo inventato'), false);
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length, 1);
  const { doc } = b.chiamate[0];
  assert.equal(C.validaChiamate(doc).ok, true, C.validaChiamate(doc).motivo);
  assert.equal(C.idDocumento(doc), C.idDocumento(b.inviati[0].doc));
  assert.deepEqual(C.leggiChiamate(doc.chiamate['filo-chat']), { c2: 1 }, 'due giri del messaggio, la cache no');
  assert.deepEqual(C.leggiChiamate(doc.chiamate.tts), { c1: 1 });
  assert.equal(doc.contesto['filo-chat'], 'deepseek/deepseek-v4-pro|t16k|2');
  assert.equal(doc.cache['filo-chat'], 'deepseek/deepseek-v4-pro|q50|2');
  assert.equal(doc.uscita['filo-chat'], 'deepseek/deepseek-v4-pro|o256|tool_calls|2');
  assert.equal(doc.spesa['filo-chat'], 'deepseek/deepseek-v4-pro|router|700');
  assert.equal(doc.spesa.tts, 'openai/gpt-4o-mini-tts|tardiva|70');
  assert.equal(doc.adattamenti['filo-chat'], 'deepseek/deepseek-v4-pro|contesto_stretto|1');
  assert.equal(doc.contesto.tts, undefined);
});

test('le chiamate in incognito e a contatori spenti non si contano, nemmeno la spesa che arriva dopo (#1464)', async () => {
  const b = banco({ incognito: true, finestra: false });
  const h = b.s.apri(A.FILO_CHAT);
  h.chiamata({ modello: 'a/b', ingresso: 1000, spesa: { usd: 1, origine: 'router' } });
  h.fine(true);
  h.tardiva('a/b', 1);
  assert.equal(b.s.adattamento(A.FILO_CHAT, 'a/b', 'finestra_piccola'), false);
  b.incognito = false;
  // Aperta fuori dall'incognito, spenta prima che il costo arrivi.
  const voce = b.s.apri(A.TTS);
  voce.fine(true);
  await attendi();
  b.accesi = false;
  voce.tardiva('openai/gpt-4o-mini-tts', 0.5);
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'spenti');
  b.accesi = true;
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length + b.chiamate.length, 0);
});

test('le chiamate che il server non accetta ancora (#1464) si riprovano il giorno dopo; l’ora già arrivata risponde 409 e non si conta due volte', async () => {
  const b = banco({ finestra: false });
  b.risposta = (doc) => (C.CAMPI_CHIAMATE.every((k) => k in doc) && 'contesto' in doc ? 403 : 200);
  const h = b.s.apri(A.EXPLAIN);
  h.chiamata({ modello: 'a/b', ingresso: 1000, uscita: 10, fine: 'stop', spesa: { usd: 0.001, origine: 'router' } });
  h.fine(true);
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  assert.equal(b.inviati.length, 1, 'l’ora è partita');
  assert.equal(b.chiamate.length, 1, 'le sue chiamate sono state rifiutate');
  assert.equal(b.inviati[0].doc.primo, 'mese');
  const stato = await b.s.letto();
  assert.equal(Object.keys(stato.ore).length, 1, 'l’ora resta per le sue chiamate');
  // Il giorno dopo le regole sono pubblicate: l'ora rispedita c'è già (409), le chiamate entrano.
  b.risposta = (doc) => ('primo' in doc ? 409 : 200);
  b.t += 24 * ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.chiamate.length, 2);
  assert.equal(b.chiamate[1].doc.spesa.explain, 'a/b|router|100');
  assert.deepEqual(Object.keys((await b.s.letto()).ore), []);
  assert.equal(b.inviati[1].doc.primo, '', 'il segno del primo documento è già dell’ora arrivata');
});

// ── Le attività (#1467) ─────────────────────────────────────────────────
test('le attività di un’ora partono accanto all’ora, con lo stesso id; un’ora senza attività non ha il terzo documento', async () => {
  const b = banco({ finestra: false });
  assert.equal(b.s.attivita('aiuto', { esito: 'fatto', passiDaSolo: 3, passiCliccati: 1, nonTrovati: 0, documenti: 0 }), true);
  assert.equal(b.s.attivita('ricercaWeb', { da: 'chat', fornitore: 'duckduckgo', ripiego: true, risultati: 5 }), true);
  assert.equal(b.s.attivita('pulizia', { trigger: 'idle', candidate: 8, archiviate: 2, duplicati: 1, giudizioMancato: false }), true);
  assert.equal(b.s.memoriaCorretta('quaderno', 'togli', { modulo: 'PROFILO', lezione: false, nata: new Date(b.t - 3 * GIORNO).toISOString() }), true);
  assert.equal(b.s.memoriaCorretta('chat', 'svuota', null), true);
  assert.equal(b.s.memoriaCorretta('chat', 'togli', null), false, 'una riga che non si sa cos’era non si conta');
  assert.equal(b.s.attivita('aiuto', { esito: 'cerca il volo per Roma' }), false, 'un esito fuori elenco non entra');
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.inviati.length, 1);
  assert.equal(b.chiamate.length, 0, 'senza chiamate ai modelli non parte il loro documento');
  assert.equal(b.attivita.length, 1);
  assert.equal(b.attivita[0].url, `${BASE}/${C.COLLEZIONE_ATTIVITA}?documentId=99999999999999999901_2026-10-15_09&key=K`);
  assert.deepEqual(b.attivita[0].doc, {
    v: 1, pseudonimo: '99999999999999999901', giorno: '2026-10-15', mese: '2026-10', ora: '09', app: '0.2.243', os: 'mac',
    aiuto: { 'fatto|p2_5|p1|n0|n0': '1' }, ricercaWeb: { 'chat|duckduckgo|si|r3_5': '1' }, dettatura: {}, lettura: {}, lezioni: {},
    compattazioni: {}, memoria: { 'quaderno|togli|profilo|settimana': '1', 'chat|svuota|tutte|nd': '1' },
    pulizia: { 'idle|s6_20|s2_5|s1|no': '1' }, riaperte: {}, home: {}, suggerimenti: {},
  });
  assert.equal(C.validaAttivita(b.attivita[0].doc).ok, true);
  // Un'ora con un solo uso e nessuna attività: niente terzo documento.
  await usa(b, A.EXPLAIN);
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.inviati.length, 2);
  assert.equal(b.attivita.length, 1);
});

test('le attività in incognito e a contatori spenti non si contano', async () => {
  const b = banco({ incognito: true, finestra: false });
  assert.equal(b.s.attivita('home', { esito: 'generata' }), false);
  b.incognito = false;
  assert.equal(b.s.attivita('riaperte', { chiusaDa: 'pulizia', etaMs: 1000 }, { incognito: true }), false, 'una finestra in incognito lo dice da sé');
  b.accesi = false;
  b.s.attivita('home', { esito: 'generata' });
  await attendi();
  b.accesi = true;
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length + b.attivita.length, 0);
});

test('le attività che il server non accetta ancora (#1467) si riprovano il giorno dopo, e l’ora già arrivata non si riscrive', async () => {
  const b = banco({ finestra: false });
  b.risposta = (doc) => ('aiuto' in doc ? 403 : 200);
  b.s.attivita('home', { esito: 'senza_ai_chiave' });
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  assert.equal(b.inviati.length, 1, 'l’ora è partita');
  assert.equal(b.attivita.length, 1, 'le sue attività sono state rifiutate');
  assert.equal(Object.keys((await b.s.letto()).ore).length, 1, 'l’ora resta per le sue attività');
  b.risposta = (doc) => ('primo' in doc ? 409 : 200);
  b.t += 24 * ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.attivita.length, 2);
  assert.deepEqual(b.attivita[1].doc.home, { senza_ai_chiave: '1' });
  assert.deepEqual(Object.keys((await b.s.letto()).ore), []);
});

test('in incognito non si conta niente e non parte nessun documento', async () => {
  const b = banco({ incognito: true, finestra: false });
  await usa(b, A.FILO_CHAT, { attesa: 900 });
  await b.s.unUso(A.FILO_CHAT, async () => { b.s.apri(A.FILO_CHAT).fine(true); });
  b.s.azione('new-tab').fine();
  b.s.ricerca('cerca-filo', { esito: 'aperta' });
  b.s.erroreVisto('crash:scheda:oom');
  b.s.impostazioniCambiate({ theme: 'light' }, { theme: 'dark' }, { via: 'mano', incognito: true });
  await attendi();
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
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati.map((x) => Object.keys(x.doc.uso)), [['help']]);
});

test('a contatori spenti non si conta niente e non parte niente, quello che c’era si butta, e lo spegnimento non manda un ultimo segnale', async () => {
  const b = banco();
  await usa(b, A.FILO_CHAT, { attesa: 900 });
  b.s.azione('reload').fine();
  await attendi();
  // Spenti con altri cambi nella stessa scrittura: nemmeno quelli si contano.
  assert.equal(b.s.impostazioniCambiate({ theme: 'light', contatori: { attivi: true } }, { theme: 'dark', contatori: { attivi: false } }, { via: 'mano' }), 0);
  b.accesi = false;
  b.s.seguiImpostazioni({ contatori: { attivi: false } });
  await attendi();
  await usa(b, A.EXPLAIN, { attesa: 300 });
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'spenti');
  b.t += GIORNO;
  await b.s.controlla();
  assert.equal(b.inviati.length, 0);
  const salvato = b.disco.get(Servizio.CHIAVE);
  assert.deepEqual(salvato.ore, {}, 'spenti, le ore raccolte prima non restano ad aspettare');
  assert.deepEqual(salvato.pseudonimi, {});
  assert.deepEqual(salvato.mesi, {});

  // Riaccesi, si riparte da zero: l'ora di prima non torna, e la prima volta del mese vale di nuovo.
  b.accesi = true;
  await usa(b, A.HELP, { attesa: 100 });
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length, 1);
  assert.deepEqual(Object.keys(b.inviati[0].doc.uso), ['help']);
  assert.deepEqual(b.inviati[0].doc.primeVolte, ['help']);
});

test('un conto partito un attimo prima dello spegnimento non rientra dopo', async () => {
  const b = banco();
  let sblocca;
  const lento = new Promise((r) => { sblocca = r; });
  // Le impostazioni si leggono in ritardo: nel frattempo arriva lo spegnimento.
  const s = Servizio.crea({
    contatori: C, storage: { getRaw: async (k, d) => d, setRaw: async (k, v) => { b.disco.set(k, JSON.parse(JSON.stringify(v))); } },
    impostazioni: async () => { await lento; return { contatori: { attivi: true } }; }, inIncognito: () => false, runNormale: (fn) => fn(),
    finestraNormale: () => false, adesso: () => b.t, versione: () => '0.2.243', piattaforma: 'linux', log: () => {},
  });
  s.azione('new-tab').fine();
  await attendi();
  s.seguiImpostazioni({ contatori: { attivi: false } });
  await attendi();
  sblocca();
  await attendi();
  const stato = await s.letto();
  assert.deepEqual(stato.ore, {});
});

test('un invio fallito riprova l’ora dopo, e al ritorno partono tutte le ore rimaste, dalla più vecchia', async () => {
  const b = banco({ risposta: 503 });
  for (let h = 0; h < 3; h++) {
    await usa(b, A.TRANSLATE_PAGE, { attesa: 2500 });
    b.t += ORA;
    assert.equal(await b.s.controlla(), 'fallito');
    assert.equal(await b.s.controlla(), 'rimandato', 'col server giù, nella stessa ora non si bussa di nuovo');
  }
  assert.equal(b.inviati.length, 3, 'un tentativo all’ora');
  b.risposta = 'rete';
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  b.risposta = 200;
  b.inviati.length = 0;
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.deepEqual(b.inviati.map((x) => x.doc.ora), ['09', '10', '11']);
  assert.equal(C.leggiMisura(b.inviati[0].doc.uso['translate-page']).n, 1);
});

test('ogni documento parte con l’identità anonima; senza, non parte niente, l’ora resta e parte quando torna (#1547)', async () => {
  const offline = Object.assign(new Error('nessuna connessione a internet'), { code: 'offline' });
  const b = banco({ identita: offline });
  await usa(b, A.FILO_CHAT, { attesa: 900 });
  b.s.gesto('trascinamento', { da: 'carta_home', a: 'chat_home', esito: 'posato' });
  b.s.navigazione(C.NAV.navFallita(-105, true));
  b.s.attivita('pulizia', { trigger: 'idle', candidate: 8, archiviate: 2, duplicati: 1, giudizioMancato: false });
  await attendi();
  assert.equal(await b.s.controlla(), 'niente');
  assert.equal(b.identitaChieste, 0, 'senza niente da spedire l’identità non si chiede');

  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  assert.deepEqual([b.inviati.length, b.chiamate.length, b.attivita.length], [0, 0, 0], 'senza identità non si bussa nemmeno');
  assert.equal(await b.s.controlla(), 'rimandato', 'nella stessa ora non si riprova');
  assert.deepEqual(Object.keys((await b.s.letto()).ore), ['2026-10-15T09'], 'l’ora resta in attesa');
  b.identita = '';
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito', 'un token vuoto vale come nessuna identità');
  assert.deepEqual([b.inviati.length, b.chiamate.length, b.attivita.length], [0, 0, 0]);

  b.identita = 'token-anonimo';
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  const partiti = [...b.inviati, ...b.chiamate, ...b.attivita];
  const collezioni = partiti.map((x) => new URL(x.url).pathname.split('/').slice(-1)[0]).sort();
  assert.deepEqual(collezioni, [C.COLLEZIONE_CHIAMATE, C.COLLEZIONE, C.COLLEZIONE_GESTI, C.COLLEZIONE_NAVIGAZIONE, C.COLLEZIONE_ATTIVITA].sort());
  for (const { opt } of partiti) assert.equal(opt.headers.Authorization, 'Bearer token-anonimo');
  assert.equal(b.inviati.find((x) => x.url.includes(`/${C.COLLEZIONE}?`)).doc.ora, '09');
  assert.ok(partiti.every(({ doc }) => !JSON.stringify(doc).includes('token-anonimo')), 'il documento non porta l’identità');
  assert.deepEqual((await b.s.letto()).ore, {});

  const spenti = banco({ accesi: false });
  await usa(spenti, A.HELP);
  spenti.t += ORA;
  assert.equal(await spenti.s.controlla(), 'spenti');
  assert.equal(spenti.identitaChieste, 0, 'a contatori spenti i contatori non chiedono né creano l’identità');
});

test('un’ora che il server rifiuta non ferma le altre: si riprova il giorno dopo, e parte quando le regole la accettano', async () => {
  const b = banco();
  const rifiuta = new Set(['explain-deep']);
  b.risposta = (doc) => (Object.keys(doc.uso || doc.chiamate).some((f) => rifiuta.has(f)) ? 403 : 200);
  await usa(b, A.EXPLAIN_DEEP); b.t += ORA;
  await usa(b, A.EXPLAIN); b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati.map((x) => x.doc.ora), ['09', '10']);
  assert.equal(b.inviati[1].doc.primo, 'mese', 'il primo è quello arrivato: l’ora rifiutata non segna il mese');
  b.inviati.length = 0;
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati, [], 'l’ora rifiutata non si ripropone nello stesso giorno');
  rifiuta.clear(); // le regole ripubblicate
  b.t += GIORNO;
  await b.s.controlla();
  assert.deepEqual(b.inviati.map((x) => [x.doc.giorno, x.doc.ora]), [['2026-10-15', '09']]);
  assert.equal(b.inviati[0].doc.primo, '', 'il suo giorno era già arrivato');
  assert.deepEqual(b.disco.get(Servizio.CHIAVE).rifiutati, {});
});

test('i giorni contati prima dell’invio ogni ora partono come allora, e non si sommano alle ore', async () => {
  const disco = new Map([[Servizio.CHIAVE, {
    giorni: { '2026-10-14': { app: '0.2.240', uso: { help: { n: 2, fasce: { s1: 2 } } }, errori: {} } },
    pseudonimi: {}, fallitoIl: '2026-10-14', rifiutati: {}, ultimo: null, errore: '',
  }]]);
  const b = banco({ disco });
  await usa(b, A.HELP, { attesa: 100 });
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length, 2);
  const [vecchio, nuovo] = b.inviati;
  assert.equal(vecchio.url, `${BASE}/${C.COLLEZIONE}?documentId=99999999999999999901_2026-10-14&key=K`);
  assert.deepEqual(vecchio.doc, { v: 1, pseudonimo: '99999999999999999901', giorno: '2026-10-14', mese: '2026-10', app: '0.2.240', os: 'mac', uso: { help: '2;0,2,0,0,0,0,0' }, errori: {} });
  assert.equal(nuovo.doc.v, C.VERSIONE);
  assert.equal(nuovo.doc.pseudonimo, vecchio.doc.pseudonimo);
  assert.deepEqual(b.disco.get(Servizio.CHIAVE).giorni, {});
});

test('un anticipo o un pezzo di un uso conta i guasti ma non un uso; la cache e la pagina contano l’uso, e l’anticipo aperto', async () => {
  const b = banco();
  await b.s.parteDiUnUso(A.EXPLAIN, async () => {
    const h = b.s.apri(A.EXPLAIN);
    h.errore(Object.assign(new Error('giù'), { status: 503 }), { modello: 'a/b', host: 'H' });
    h.fine(false);
  });
  await b.s.parteDiUnUso(A.EXPLAIN, async () => { const h = b.s.apri(A.EXPLAIN); b.t += 900; h.visto(); h.fine(true); });
  assert.equal(b.s.anticipoPronto(A.EXPLAIN), true);
  assert.equal(b.s.anticipoPronto(A.EXPLAIN), true);
  assert.equal(b.s.usoDallaPagina(A.EXPLAIN, 1500, { anticipata: true }), true);
  assert.equal(b.s.usoDallaPagina('una funzione inventata', 10), false);
  b.s.servitaDaCache(A.EXPLAIN);
  await b.s.unUso(A.FILO_CHAT, async () => { b.s.servitaDaCache(A.FILO_CHAT); });
  b.incognito = true;
  assert.equal(b.s.usoDallaPagina(A.EXPLAIN, 10), false, 'in incognito la pagina non conta');
  b.s.servitaDaCache(A.EXPLAIN);
  b.incognito = false;
  assert.equal(b.s.chiesto(A.DESCRIBE_IMAGE), true);
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  const { doc } = b.inviati[0];
  assert.deepEqual(C.leggiMisura(doc.uso.explain), { n: 2, visto: { ms500: 1, s2: 1 }, fine: { ms500: 1, s2: 1 }, ripetute: 1 });
  assert.deepEqual(C.leggiMisura(doc.uso['filo-chat']).n, 1);
  assert.deepEqual(C.leggiErrori(doc.errori.explain), [{ modello: 'a/b', host: 'H', tipo: 'fornitore', n: 1 }]);
  assert.deepEqual(doc.anticipi, { explain: '2;1' }, 'due preparate, una aperta: l’altra non l’ha mai vista nessuno');
  assert.deepEqual(doc.chiedi, { 'describe-image': '1' });
});

test('un’azione misura il gesto fino alla prima cosa visibile e fino alla fine; rifatta subito è una richiesta ripetuta', async () => {
  const b = banco();
  // Una scheda nuova: visibile al primo DOM pronto, finita quando smette di caricare.
  const wc = new EventEmitter();
  wc.isDestroyed = () => false;
  const h = b.s.azione('new-tab');
  h.scheda(wc);
  b.t += 300; wc.emit('dom-ready');
  b.t += 2000; wc.emit('did-stop-loading');
  b.t += 1000;
  // Ricaricata due volte di fila: la seconda è ripetuta.
  b.s.azione('reload').fine();
  b.t += 3000;
  b.s.azione('reload').fine();
  b.t += 60 * 1000;
  b.s.azione('reload').fine();
  // Misurata dalla pagina che l'ha vista, con le attese già fatte.
  assert.equal(b.s.azioneMisurata('screenshot', { vistoMs: 120, fineMs: 900 }), true);
  assert.equal(b.s.azioneMisurata('un’azione inventata', { fineMs: 1 }), false);
  assert.equal(b.s.azione('nuova scheda di Mario'), b.s.azione('altro inventato'), 'fuori elenco: una maniglia muta');
  // Una pagina che non risponde: dopo un minuto l'azione conta, senza fascia.
  const ferma = new EventEmitter(); ferma.isDestroyed = () => false;
  b.s.azione('navigate-back-forward').scheda(ferma);
  b.t += 61 * 1000;
  await new Promise((r) => setTimeout(r, 5));
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  const { doc } = b.inviati[0];
  assert.deepEqual(C.leggiMisura(doc.azioni['new-tab']), { n: 1, visto: { ms500: 1 }, fine: { s5: 1 }, ripetute: 0 });
  assert.deepEqual(C.leggiMisura(doc.azioni.reload), { n: 3, visto: { ms500: 3 }, fine: { ms500: 3 }, ripetute: 1 });
  assert.deepEqual(C.leggiMisura(doc.azioni.screenshot), { n: 1, visto: { ms500: 1 }, fine: { s1: 1 }, ripetute: 0 });
  assert.deepEqual(doc.primeVolte, ['new-tab', 'reload', 'screenshot']);
});

test('le impostazioni cambiate: la chiave, il valore se è di elenco chiuso, chi l’ha chiesto; mai in incognito', async () => {
  const b = banco();
  const n = (x) => globalThis.SN_STORAGE?.normalizza ? globalThis.SN_STORAGE.normalizza(x) : x;
  assert.equal(b.s.impostazioniCambiate({ theme: 'light', themeTokens: {} }, { theme: 'dark', themeTokens: { accent: '#f00', bordo: '#0f0' } }, { via: 'mano', normalizza: n }), 2);
  assert.equal(b.s.impostazioniCambiate({ spiegaAnticipata: { enabled: true } }, { spiegaAnticipata: { enabled: false } }, { via: 'chat' }), 1);
  assert.equal(b.s.impostazioniCambiate({ autonomia: { livello: 'default' } }, { autonomia: { livello: 'automatico' } }, { via: 'mano' }), 1);
  assert.equal(b.s.impostazioniCambiate({ pricing: { a: 1 } }, { pricing: { a: 2 } }, { via: 'auto' }), 0, 'i prezzi li scrive Filo: non sono un cambio');
  assert.equal(b.s.impostazioniCambiate({ theme: 'dark' }, { theme: 'light' }, { via: 'mano', incognito: true }), 0);
  assert.equal(b.s.impostazioniCambiate({ theme: 'dark' }, { theme: 'light' }, { via: 'una via inventata' }), 0);
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati[0].doc.impostazioni, {
    theme: 'dark|mano|1', 'themeTokens.*': 'cambiato|mano|1', 'spiegaAnticipata.enabled': 'spento|chat|1', 'autonomia.livello': 'automatico|mano|1',
  });
});

test('le conferme: la risposta calcolata coi suoi ingressi, e quello che ha fatto la persona', async () => {
  const b = banco();
  const info = { livello: 'default', stato: 'pulito', costo: 2, perimetro: 'dentro', origine: 'chat' };
  b.s.confermaDecisa('NAVIGA', { ...info, costo: 1, risposta: 'si' }, 'automatica');
  b.s.confermaDecisa('ESEGUI_COMANDO', { ...info, costo: 3, risposta: 'no' }, 'negata');
  b.s.confermaChiesta('k1', 'CANCELLA_PAGINE', { ...info, risposta: 'chiede' });
  b.s.confermaChiesta('k2', 'CANCELLA_PAGINE', { ...info, risposta: 'chiede' });
  b.s.confermaChiesta('k3', 'IMPOSTA_PREFERENZA', { ...info, risposta: 'conferma', stato: 'contaminato' });
  assert.equal(b.s.confermaRisposta('k1', 'approvata'), true);
  assert.equal(b.s.confermaRisposta('k2', 'rifiutata'), true);
  assert.equal(b.s.confermaRisposta('k1', 'approvata'), false, 'una risposta vale una volta');
  await attendi();
  b.t += 11 * 60 * 1000; // k3 resta senza risposta
  b.s.azione('reload').fine();
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati[0].doc.conferme, {
    NAVIGA: 'default|pulito|1|dentro|chat|si|automatica|1',
    ESEGUI_COMANDO: 'default|pulito|3|dentro|chat|no|negata|1',
    CANCELLA_PAGINE: 'default|pulito|2|dentro|chat|chiede|approvata|1;default|pulito|2|dentro|chat|chiede|rifiutata|1',
    IMPOSTA_PREFERENZA: 'default|contaminato|2|dentro|chat|conferma|senza-risposta|1',
  });
});

test('un annullo subito dopo un’azione di Filo conta per tipo; dopo mezzo minuto è un cambio di idea', async () => {
  const b = banco();
  b.s.azioneDiFilo('IMPOSTA_PREFERENZA', ['c1']);
  b.t += 5000;
  assert.equal(b.s.cambioAnnullato('c1'), true);
  assert.equal(b.s.cambioAnnullato('c1'), false, 'lo stesso cambio non si annulla due volte');
  b.s.azioneDiFilo('IMPOSTA_ESTETICA', ['c2']);
  b.t += 31 * 1000;
  assert.equal(b.s.cambioAnnullato('c2'), false);
  b.s.azioneDiFilo('NAVIGA', []);
  b.t += 2000;
  assert.equal(b.s.tastoAnnulla(), true, 'Ctrl/Cmd+Z subito dopo');
  assert.equal(b.s.tastoAnnulla(), false);
  assert.equal(b.s.annullatoInPagina('correzione-automatica'), true);
  assert.equal(b.s.annullatoInPagina('un testo qualunque'), false);
  assert.equal(b.s.annullatoInPagina('correzione', 45 * 1000), false, 'un Ctrl+Z dopo tre quarti di minuto è un’altra cosa');
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati[0].doc.annullati, { IMPOSTA_PREFERENZA: '1', NAVIGA: '1', 'correzione-automatica': '1' });
});

test('ricerche, correttore, errori visti e intervista entrano nell’ora; quello fuori elenco no', async () => {
  const b = banco();
  assert.equal(b.s.ricerca('cerca-filo', { esito: 'aperta' }), true);
  assert.equal(b.s.ricerca('cerca-filo', { esito: 'scelta', attesaMs: 2500, posizione: 3 }), true);
  assert.equal(b.s.ricerca('la barra di Mario', { esito: 'aperta' }), false);
  assert.equal(b.s.proposta('ortografia', 'deepseek/deepseek-v4-flash', 'accettata'), true);
  assert.equal(b.s.proposta('ortografia', 'deepseek/deepseek-v4-flash', 'boh'), false);
  assert.equal(b.s.erroreVisto('avviso:qr_error'), true);
  assert.equal(b.s.erroreVisto('avviso:Impossibile aprire relazione.pdf'), false);
  assert.equal(b.s.intervista('autonomia', 'conservativo'), true);
  assert.equal(b.s.intervista('profilo', 'faccio il medico'), false);
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  const { doc } = b.inviati[0];
  assert.deepEqual(C.leggiRicerca(doc.ricerche['cerca-filo']), { aperte: 1, scelte: { s5: 1 }, posizioni: { p3: 1 }, vuote: 0 });
  assert.deepEqual(doc.correttore, { ortografia: 'deepseek/deepseek-v4-flash|0,1,0,0' });
  assert.deepEqual(doc.erroriVisti, { 'avviso:qr_error': '1' });
  assert.deepEqual(doc.intervista, { autonomia: 'conservativo|1' });
});

test('le ore rimaste partono con un tetto, e il resto il giro dopo', async () => {
  const b = banco({ risposta: 503 });
  const ore = C.TETTO_INVII_PER_GIRO + 4;
  for (let h = 0; h < ore; h++) { await usa(b, A.HELP); b.t += ORA; }
  b.risposta = 200;
  b.inviati.length = 0;
  await b.s.controlla();
  assert.equal(b.inviati.length, C.TETTO_INVII_PER_GIRO);
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.inviati.length, ore);
});

test('l’ultima ora del mese, spedita il mese dopo, porta lo pseudonimo del suo mese', async () => {
  const b = banco();
  b.t = new Date(2026, 9, 31, 23, 10, 0).getTime();
  await usa(b, A.HELP);
  b.t = new Date(2026, 10, 1, 0, 5, 0).getTime();
  await usa(b, A.HELP);
  b.t += ORA;
  await b.s.controlla();
  const [ott, nov] = b.inviati.map((x) => x.doc);
  assert.deepEqual([ott.giorno, ott.ora], ['2026-10-31', '23']);
  assert.deepEqual([nov.giorno, nov.ora], ['2026-11-01', '00']);
  assert.notEqual(ott.pseudonimo, nov.pseudonimo, 'al mese nuovo uno pseudonimo nuovo');
  assert.deepEqual(nov.primeVolte, ['help'], 'il mese nuovo ha le sue prime volte');
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

test('l’owner conta gli pseudonimi distinti leggendo solo i primi documenti di ogni copia, pagina dopo pagina', async () => {
  const chieste = [];
  const chiaveDi = (q) => (q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where])
    .map((f) => `${f.fieldFilter.field.fieldPath}=${Object.values(f.fieldFilter.value)[0]}`).join('&');
  // Le copie che spediscono ogni ora contano col loro primo documento; quelle d'allora col documento del giorno.
  const pagine = {
    'giorno=2026-10-31&primo=giorno': [['a', 'b']],
    'giorno=2026-10-31&primo=mese': [['a']],
    'giorno=2026-10-31&v=1': [['c']],
    'mese=2026-11&primo=mese': [Array.from({ length: 1000 }, (_, i) => `p${i % 700}`), ['p1', 'nuovo']],
    'mese=2026-11&v=1': [['p2', 'vecchio']],
  };
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
      const chiave = chiaveDi(q);
      const pagina = (pagine[chiave] || [])[q.startAt ? 1 : 0] || [];
      const righe = pagina.map((p, i) => ({ document: { name: `${BASE}/${C.COLLEZIONE}/${chiave}${q.startAt ? 'b' : 'a'}${i}`, fields: { pseudonimo: { stringValue: p } } } }));
      return { ok: true, status: 200, json: async () => (righe.length ? righe : [{ readTime: 'x' }]) };
    },
  });
  const r = await s.installazioni({ idToken: 'tok' });
  // Il primo del mese: «ieri» è l'ultimo giorno del mese prima, il mese in corso è quello nuovo.
  assert.deepEqual(r, { ieri: { giorno: '2026-10-31', n: 3, completo: true }, mese: { mese: '2026-11', n: 702, completo: true } });
  assert.deepEqual(new Set(chieste.map((c) => chiaveDi(c.q))), new Set(Object.keys(pagine)), 'nessuna lettura di tutte le ore');
  assert.ok(chieste.every((c) => c.url === `${BASE}:runQuery?key=K` && c.auth === 'Bearer tok'));
  assert.ok(chieste.every((c) => JSON.stringify(c.q.select) === JSON.stringify({ fields: [{ fieldPath: 'pseudonimo' }] })), 'si chiede solo lo pseudonimo');
  const seconda = chieste.find((c) => c.q.startAt);
  assert.equal(seconda.q.startAt.values[0].referenceValue, `${BASE}/${C.COLLEZIONE}/mese=2026-11&primo=mesea999`);
  await assert.rejects(s.installazioni({}), /Sessione scaduta/);
});

test('a Filo si chiede a parole: «contatori» e i suoi sinonimi accendono e spengono l’interruttore, con conferma', () => {
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  const P = globalThis.SN_PREF;
  for (const chiave of ['contatori', 'contatori anonimi', 'telemetria', 'statistiche d\'uso']) {
    const r = P.buildPreferencePartial(chiave, 'no');
    assert.deepEqual(r && r.partial, { contatori: { attivi: false } }, chiave);
    assert.equal(r.costo, 2);
    assert.ok(r.risk);
  }
  assert.deepEqual(P.buildPreferencePartial('contatori', 'sì').partial, { contatori: { attivi: true } });
  assert.deepEqual(globalThis.SN_CONST.DEFAULT_SETTINGS.contatori, { attivi: true }, 'accesi di serie (D52)');
});

test('l’intervista lasciata a metà senza chiuderla conta l’abbandono al suo passo dopo un giorno di fermo, una volta', async () => {
  const b = banco();
  const oraDi = (b2) => C.oraDi(b2.t);
  const abbandoni = (b2) => Object.values(b2.disco.get(Servizio.CHIAVE)?.ore || {})
    .reduce((n, o) => n + ((o.intervista && o.intervista.stile && o.intervista.stile.abbandono) || 0), 0);
  await b.s.intervistaToccata('stile', false);
  b.t += 23 * ORA;
  await b.s.controlla();
  assert.equal(abbandoni(b), 0, 'ferma da meno di un giorno non è abbandonata');
  b.t += 2 * ORA;
  await b.s.controlla();
  await b.s.salva();
  assert.equal(abbandoni(b), 1, `ferma da un giorno è abbandonata al passo dove si trova (${oraDi(b)})`);
  b.t += GIORNO;
  await b.s.controlla();
  await b.s.salva();
  const dopo = abbandoni(b) + b.inviati.reduce((n, x) => n + Number(String(x.doc.intervista?.stile || '').match(/abbandono\|(\d+)/)?.[1] || 0), 0);
  assert.equal(dopo, 1, 'l’abbandono si conta una volta sola');
  // Chiusa poi a metà con «Salta», lo stesso abbandono non si conta di nuovo.
  assert.equal(b.s.intervistaAbbandonata('stile'), false);
  await b.s.intervistaToccata('', true);
  assert.equal((await b.s.letto()).intervista, null, 'chiusa, si dimentica');
});

test('a contatori spenti l’intervista aperta non si ricorda e non si conta', async () => {
  const b = banco({ accesi: false });
  await b.s.intervistaToccata('stile', false);
  b.t += 2 * GIORNO;
  await b.s.controlla();
  assert.equal((await b.s.letto()).intervista, null);
  assert.equal(b.inviati.length, 0);
});

// ── La chat e l'agente (#1463) ──────────────────────────────────────────────
// La chat dell'ora parte nel suo documento, dopo quello dell'ora.
const ultimaOra = async (b) => { b.t += ORA; await b.s.controlla(); return b.inviati.filter((x) => x.doc.v === C.VERSIONE_CHAT).pop().doc; };

test('un turno di chat si conta alla fine, col suo esito: giri, azioni per giro, strumenti e strade di riserva', async () => {
  const b = banco();
  const t = b.s.turnoChat(A.FILO_CHAT);
  t.giro(); t.azioni(2); t.strumento('CERCA_WEB', 'eseguito'); t.strumento('naviga', 'rifiutato');
  t.recupero('contesto_stretto'); t.recupero('contesto_stretto'); t.recupero('una strada inventata');
  t.giro(); t.azioni(1); t.strumento('LEGGI_PAGINA', 'eseguito');
  t.giro();
  await attendi();
  assert.equal(b.disco.has(Servizio.CHIAVE) && Object.keys(b.disco.get(Servizio.CHIAVE).ore).length, false, 'prima della fine non c’è niente');
  t.fine('risposta');
  t.fine('errore');
  await attendi();
  // Un turno senza esito (il congedo dell'intervista) e uno da una funzione che non gira con gli strumenti non contano.
  b.s.turnoChat(A.FILO_CHAT).fine('');
  b.s.turnoChat(A.EXPLAIN).fine('risposta');
  const errore = b.s.turnoChat(A.FILO_CHAT);
  errore.fine('errore');
  await attendi();
  const doc = await ultimaOra(b);
  assert.deepEqual(doc.chatTurni, { 'filo-chat': 'risposta|g3|1;errore|g1|1' });
  assert.deepEqual(doc.azioniPerGiro, { 'filo-chat': '1,1,0,0' });
  assert.deepEqual(doc.strumenti, { 'filo-chat': 'NAVIGA|rifiutato|1;CERCA_WEB|eseguito|1;LEGGI_PAGINA|eseguito|1' });
  assert.deepEqual(doc.chatRecuperi, { contesto_stretto: '1' }, 'una strada si conta una volta per turno');
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
});

test('un turno, una reazione o una copia in incognito non si contano', async () => {
  const b = banco({ incognito: true, finestra: false });
  const t = b.s.turnoChat(A.FILO_CHAT);
  t.giro(); t.strumento('NAVIGA', 'eseguito');
  b.incognito = false;
  t.fine('risposta');
  b.incognito = true;
  assert.equal(b.s.reazione('riprova'), true);
  assert.equal(b.s.copia('risposta'), true);
  assert.equal(await b.s.chatChiusa('c1', { via: 'uscita', messaggi: 2, durataMs: 1000 }), false);
  await attendi();
  b.incognito = false;
  b.t += GIORNO;
  await b.s.controlla();
  assert.equal(b.inviati.length, 0, JSON.stringify(b.inviati.map((x) => x.doc)));
  assert.equal(b.s.reazione('fermato a metà'), false);
  assert.equal(b.s.copia('la bolla di mario'), false);
});

test('reazioni e copie entrano nell’ora in cui succedono', async () => {
  const b = banco();
  for (const v of ['ferma_durante_azioni', 'riprendi', 'riprova', 'riprova']) b.s.reazione(v);
  for (const r of ['risposta', 'utente']) b.s.copia(r);
  await attendi();
  const doc = await ultimaOra(b);
  assert.deepEqual(doc.chatReazioni, { ferma_durante_azioni: '1', riprendi: '1', riprova: '2' });
  assert.deepEqual(doc.chatCopie, { risposta: '1', utente: '1' });
});

test('una chat chiusa aspetta il suo tipo sul disco: si conta quando arriva, anche dopo un riavvio, e dopo due giorni senza', async () => {
  const b = banco();
  assert.equal(await b.s.chatChiusa('c-oggi', { via: 'chat_nuova', messaggi: 3, durataMs: 4 * 60 * 1000 }), true);
  assert.equal(await b.s.chatChiusa('c-uscita', { via: 'uscita', messaggi: 1, durataMs: 0 }), true);
  assert.equal(await b.s.chatChiusa('c-vuota', { via: 'uscita', messaggi: 0, durataMs: 0 }), false, 'senza messaggi della persona non è una chat');
  assert.equal(await b.s.chatChiusa('c-strana', { via: 'chiusa da mario', messaggi: 2 }), false);
  assert.ok(b.disco.get(Servizio.CHIAVE).chiuse['c-uscita'], 'la chiusa aspetta sul disco, subito');
  assert.equal(await b.s.chatClassificata('c-oggi', 'conversazione'), true);
  assert.equal(await b.s.chatClassificata('c-oggi', 'comando'), false, 'una chat si conta una volta');
  assert.equal(await b.s.chatClassificata('mai-chiusa', 'comando'), false);
  await attendi();

  // Filo si chiude prima della classificazione: al riavvio la chat aspetta ancora, e si conta quando la classifica il giro dopo.
  const dopo = banco({ disco: b.disco });
  dopo.t = b.t;
  assert.equal(await dopo.s.chatClassificata('c-uscita', 'comando'), true);
  await attendi();
  const doc = await ultimaOra(dopo);
  assert.deepEqual(doc.chatChiuse, { chat_nuova: 'm3_5|min5|conversazione|1', uscita: 'm1|min1|comando|1' });
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
  assert.equal(JSON.stringify(doc).includes('c-uscita'), false, 'l’id della chat resta sul disco di chi usa Filo');

  // Una che il classificatore non raggiunge mai esce senza tipo dopo due giorni.
  await dopo.s.chatChiusa('c-ferma', { via: 'appesa_all_avvio', messaggi: 2, durataMs: 0 });
  dopo.t += 2 * GIORNO + ORA;
  await dopo.s.controlla();
  const tardi = await ultimaOra(dopo);
  assert.deepEqual(tardi.chatChiuse, { appesa_all_avvio: 'm2|min1|nessuno|1' });
  assert.deepEqual(dopo.disco.get(Servizio.CHIAVE).chiuse, {});
});

test('spenti, le chat chiuse in attesa si buttano e non se ne aggiungono', async () => {
  const b = banco();
  await b.s.chatChiusa('c1', { via: 'uscita', messaggi: 2, durataMs: 0 });
  b.accesi = false;
  assert.equal(await b.s.chatChiusa('c2', { via: 'uscita', messaggi: 2, durataMs: 0 }), false);
  assert.deepEqual(b.disco.get(Servizio.CHIAVE).chiuse || {}, {});
  b.accesi = true;
  assert.equal(await b.s.chatClassificata('c1', 'comando'), false);
});

test('la chat dell’ora parte nel suo documento dopo l’ora; rifiutata, riparte il giorno dopo e l’ora già arrivata risponde 409', async () => {
  const b = banco();
  const fuori = (doc) => (doc.v === C.VERSIONE_CHAT ? 403 : 200);
  b.risposta = fuori;
  await usa(b, A.HELP, { attesa: 100 });
  b.s.reazione('riprova');
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  assert.deepEqual(b.inviati.map((x) => x.doc.v), [C.VERSIONE, C.VERSIONE_CHAT]);
  const [ora, chat] = b.inviati;
  assert.equal(chat.url, `${BASE}/${C.COLLEZIONE}?documentId=${C.idDocumento(ora.doc)}_chat&key=K`);
  assert.deepEqual(Object.keys(chat.doc), [...C.CAMPI_CHAT]);
  assert.deepEqual([chat.doc.pseudonimo, chat.doc.giorno, chat.doc.ora], [ora.doc.pseudonimo, ora.doc.giorno, ora.doc.ora]);
  assert.deepEqual(chat.doc.chatReazioni, { riprova: '1' });
  assert.equal(Object.keys(b.disco.get(Servizio.CHIAVE).ore).length, 1, 'l’ora aspetta la sua chat');
  assert.equal(ora.doc.primo, 'mese');

  // Il giorno dopo le regole la conoscono: l'ora già arrivata risponde 409, la chat parte, e niente resta.
  const gia = new Set([C.idDocumento(ora.doc)]);
  b.risposta = (doc) => (gia.has(C.idDocumento(doc)) ? 409 : 200);
  b.t += GIORNO;
  await b.s.controlla();
  const dopo = b.inviati.slice(2).filter((x) => x.doc.giorno === '2026-10-15');
  assert.deepEqual(dopo.map((x) => x.doc.v), [C.VERSIONE, C.VERSIONE_CHAT]);
  assert.deepEqual(Object.keys(b.disco.get(Servizio.CHIAVE).ore).filter((k) => k.startsWith('2026-10-15')), []);

  // Un'ora senza niente della chat manda solo il suo documento.
  await usa(b, A.HELP, { attesa: 100 });
  const n = b.inviati.length;
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(b.inviati.slice(n).map((x) => x.doc.v), [C.VERSIONE]);
});

// Chiudere una scheda, una finestra o Filo non dà alla pagina nessun evento (#1467): quello che aveva aperto lo conta il
// main, una volta, com'era all'ultimo aggiornamento; quello che la pagina ha già contato da sé non si riconta.
test('le attività aperte in una pagina che se ne va si contano una volta, col loro ultimo stato', async () => {
  const b = banco();
  const aiuto = (esito, passi) => ({ esito, passiDaSolo: passi, passiCliccati: 0, nonTrovati: 0, documenti: 0 });
  assert.equal(b.s.apertaInCorso('7|aiuto|a1', 'aiuto', aiuto('chiusa_prima', 0)), true);
  b.s.apertaInCorso('7|aiuto|a1', 'aiuto', aiuto('fatto', 2));
  b.s.apertaInCorso('7|lettura|l1', 'lettura', { voce: 'modello', motivo: 'nessuno', fino: 'q50' });
  b.s.apertaInCorso('8|aiuto|a2', 'aiuto', aiuto('fatto', 1));
  // La lettura l'ha chiusa la pagina: conta lei, e il main la dimentica.
  b.s.finitaInCorso('7|lettura|l1');
  b.s.chiudiInCorso('7|');
  await attendi();
  let ora = Object.values((await b.s.letto()).ore)[0];
  assert.deepEqual(ora.aiuto, { 'fatto|p2_5|p0|n0|n0': 1 });
  assert.deepEqual(ora.lettura, {});
  b.s.chiudiInCorso('7|');
  // Filo che si chiude conta le altre e salva sul disco prima di uscire.
  const congedo = b.s.congeda();
  assert.ok(congedo, 'c’era qualcosa da contare');
  await congedo;
  ora = Object.values(b.disco.get(Servizio.CHIAVE).ore)[0];
  assert.deepEqual(ora.aiuto, { 'fatto|p2_5|p0|n0|n0': 1, 'fatto|p1|p0|n0|n0': 1 });
  assert.equal(b.s.congeda(), null, 'niente più da contare né da salvare');
  // In incognito non si tiene niente.
  b.incognito = true;
  assert.equal(b.s.apertaInCorso('9|aiuto|a3', 'aiuto', aiuto('fatto', 1)), false);
});
