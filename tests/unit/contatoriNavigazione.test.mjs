// I contatori della navigazione (#1469): ogni voce si costruisce solo da elenchi chiusi, e un indirizzo, un dominio o
// un nome di file passati per sbaglio non escono; il documento parte accanto all'ora, mai in incognito né a contatori
// spenti; la pulizia dei cookie arriva sul disco prima dell'uscita; una lista già fresca non blocca i giri dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

// La cache delle liste va in una cartella sua, non nella cartella da cui parte la prova.
process.env.FILO_USER_DATA = cartellaTemporanea('filo-contatori-nav-');
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const C = globalThis.SN_CONTATORI;
const N = C.NAV;

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

function banco({ accesi = true, incognito = false, risposta = 200 } = {}) {
  const disco = new Map();
  const per = { ore: [], chiamate: [], navigazione: [] };
  const b = { t: T0, accesi, incognito, risposta, disco, per, n: 0 };
  b.s = Servizio.crea({
    contatori: C,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => b.incognito,
    runNormale: (fn) => fn(),
    finestraNormale: () => true,
    adesso: () => b.t,
    versione: () => '0.2.249',
    piattaforma: 'linux',
    esclusi: async () => [],
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    idToken: async () => 'token-anonimo',
    fetch: async (url, opt) => {
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      const dove = url.includes(`/${C.COLLEZIONE_NAVIGAZIONE}?`) ? 'navigazione' : url.includes(`/${C.COLLEZIONE_CHIAMATE}?`) ? 'chiamate' : 'ore';
      per[dove].push({ url, doc });
      const st = typeof b.risposta === 'function' ? b.risposta(dove, doc) : b.risposta;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
    },
    log: () => {},
  });
  return b;
}

// Quello che ogni misura riceve da chi la chiama per sbaglio: un indirizzo, un dominio, un nome di file.
const SPORCHI = ['https://mario.rossi.it/conto?id=42', 'mario.rossi.it', 'relazione finale.docx'];

test('ogni voce viene dai suoi elenchi: quello che non ne è parte diventa «altro» o non si conta', () => {
  assert.deepEqual(N.navFallita(-105, true), { misura: 'navFallite', chiave: '-105', voci: ['proxy'] });
  assert.deepEqual(N.navFallita('-7', false).chiave, '-7');
  assert.equal(N.navFallita(-3, false).chiave, 'altro', 'un codice senza messaggio suo è «altro»');
  assert.deepEqual(N.navRiprova(-106, true).voci, ['riuscita']);
  assert.equal(N.geoRilevato('text_pattern').chiave, 'text_pattern');
  assert.equal(N.geoClasse({ class: 'paywall', route: {} }).chiave, 'paywall');
  assert.equal(N.geoClasse({ class: null, skipped: true, reason: 'budget' }).chiave, 'saltato_budget');
  assert.equal(N.geoClasse({ class: 'errore_generico', error: 'no_model' }).chiave, 'no_model');
  assert.equal(N.geoClasse({ class: null, skipped: true }), null, 'un caso non ambiguo il modello non lo vede: niente classe');
  assert.equal(N.geoClasse(null), null);
  assert.equal(N.geoDecisione('login_session').chiave, 'login_session');
  assert.equal(N.proxy('jp', 'residential', true).chiave, 'jp|residential');
  assert.equal(N.proxy('it', undefined, false).chiave, 'altro|datacenter', 'un paese fuori dalla scelta della UI è «altro»');
  assert.deepEqual(N.lista('adblock', { ok: true, skipped: true }, 3 * GIORNO, 0).voci, ['saltato', 'g7', 'd0']);
  assert.deepEqual(N.lista('cookie_banner', { ok: false, error: 'download_failed' }, null, 12000).voci, ['download_failed', 'mai', 'd50k']);
  assert.deepEqual(N.lista('adblock', { ok: false, error: 'ENOSPC: no space' }, 90 * GIORNO, 250000).voci, ['errore', 'oltre', 'd500k']);
  assert.deepEqual(N.lista('adblock', { ok: true }, 0, 80000).voci, ['ok', 'g1', 'd100k']);
  assert.deepEqual(N.sitoBloccato('lists'), { misura: 'sitiBloccati', chiave: 'liste', voci: ['bloccato'] });
  assert.deepEqual(N.apriComunque('blacklist'), { misura: 'sitiBloccati', chiave: 'lista_utente', voci: ['apri_comunque'] });
  assert.equal(N.banner('hidden').chiave, 'hidden');
  assert.equal(N.banner('answer'), null, 'la risposta di un sito al banner non è un esito');
  assert.equal(N.pulizia('tetto_2500ms').chiave, 'tetto_2500ms');
  assert.equal(N.riquadro('google-maps', 'ancora_rotto').chiave, 'google-maps');
  assert.deepEqual(N.scaricamento('completed', 700 * 1024 * 1024, 5 * 60 * 1000).voci, ['m1000', 'min10']);
  assert.deepEqual(N.scaricamento('interrupted', 0, NaN).voci, ['m1', 's1'], 'senza dimensione né durata, la fascia più bassa');
  assert.equal(N.scaricamento('progressing', 1, 1), null, 'uno scaricamento in corso non è un esito');
  assert.equal(N.programma('immagine_disco', 'domanda').chiave, 'immagine_disco');
  assert.equal(N.programma('programma', 'aperto').voci[0], 'aperto');
  // Il Riprova di un crash o di una pagina bloccata non è un codice di rete.
  assert.equal(N.navRiprova('crash', false).chiave, 'altro');
});

test('una prova per misura: un indirizzo, un dominio e un nome di file passati alla registrazione non escono', async () => {
  const b = banco();
  const voci = {
    navFallite: (x) => [N.navFallita(x, true)],
    navRiprove: (x) => [N.navRiprova(x, false)],
    geoRilevati: (x) => [N.geoRilevato(x)],
    geoClassi: (x) => [N.geoClasse({ class: x }), N.geoClasse({ class: 'geo_block', error: x })],
    geoDecisioni: (x) => [N.geoDecisione(x)],
    geoProxy: (x) => [N.proxy(x, x, true)],
    liste: (x) => [N.lista(x, { ok: true }, 0, 1), N.lista('adblock', { ok: false, error: x }, x, x)],
    sitiBloccati: (x) => [N.sitoBloccato(x), N.apriComunque(x)],
    bannerCookie: (x) => [N.banner(x)],
    puliziaCookie: (x) => [N.pulizia(x)],
    riquadri: (x) => [N.riquadro(x, 'regola'), N.riquadro('youtube', x)],
    scaricamenti: (x) => [N.scaricamento(x, 1, 1), N.scaricamento('completed', x, x)],
    programmi: (x) => [N.programma(x, 'domanda'), N.programma('programma', x)],
  };
  assert.deepEqual(Object.keys(voci).sort(), [...C.MISURE_NAVIGAZIONE].sort(), 'ogni misura ha la sua prova');
  for (const [misura, fai] of Object.entries(voci)) {
    for (const x of SPORCHI) for (const v of fai(x)) { if (v) { assert.equal(v.misura, misura); b.s.navigazione(v); } }
    // E anche dritto nel registro, scavalcando i costruttori: una chiave o una voce fuori elenco non entra.
    for (const x of SPORCHI) assert.equal(C.registraNavigazione(C.oraVuota(), misura, x, [x]), false, `${misura}: «${x}» entrerebbe nell'ora`);
  }
  await attendi();
  const disco = JSON.stringify(b.disco.get(Servizio.CHIAVE));
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  const tutto = JSON.stringify([b.per, disco]);
  for (const x of [...SPORCHI, 'mario', 'rossi', 'docx', 'conto']) assert.ok(!tutto.includes(x), `«${x}» è uscito`);
  // Le voci che hanno un «altro» lo hanno contato: niente si perde, niente parla.
  const [{ doc }] = b.per.navigazione;
  assert.equal(doc.navFallite.altro, '0,3');
  assert.equal(doc.geoProxy['altro|datacenter'], '3,0');
  assert.equal(doc.riquadri.altro, '3,0,0,0,0,0,0,0,0,0,0');
});

test('la navigazione parte accanto alla sua ora, con lo stesso id; un’ora senza navigazione non ha il terzo documento', async () => {
  const b = banco();
  b.s.navigazione(N.navFallita(-105, false));
  b.s.navigazione(N.navFallita(-105, true));
  b.s.navigazione(N.scaricamento('completed', 5 * 1024 * 1024, 12000));
  b.s.navigazione(N.lista('adblock', { ok: true }, 0, 140000));
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per.ore.length, 1, 'un’ora di sola navigazione parte lo stesso, vuota');
  assert.equal(b.per.chiamate.length, 0);
  assert.equal(b.per.navigazione.length, 1);
  const [{ url, doc }] = b.per.navigazione;
  assert.ok(url.includes(`documentId=${encodeURIComponent(C.idDocumento(b.per.ore[0].doc))}`), 'lo stesso id dell’ora');
  assert.deepEqual(Object.keys(doc), [...C.CAMPI_NAVIGAZIONE]);
  assert.equal(doc.navFallite['-105'], '1,1');
  assert.equal(doc.scaricamenti.completed, '0,1,0,0,0;0,0,1,0,0,0');
  assert.deepEqual(C.leggiNavigazione('liste', doc.liste.adblock), [
    { ok: 1, saltato: 0, download_failed: 0, errore: 0 },
    { g1: 1, g7: 0, g14: 0, g30: 0, oltre: 0, mai: 0 },
    { d0: 0, d1k: 0, d10k: 0, d50k: 0, d100k: 0, d500k: 1, oltre: 0 },
  ]);
  assert.equal(C.validaNavigazione(doc).ok, true);
  assert.deepEqual(doc.bannerCookie, {}, 'una misura senza conti esce vuota');

  b.s.navigazione(N.banner('hidden'));
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.navigazione.length, 2);
  b.s.erroreVisto('rete:-105');
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.ore.length, 3);
  assert.equal(b.per.navigazione.length, 2, 'l’ora senza navigazione non ha il suo documento');
});

test('in incognito e a contatori spenti la navigazione non si conta e non parte; spenti, quella in attesa si butta', async () => {
  const b = banco({ incognito: true });
  b.s.navigazione(N.navFallita(-105, false));
  b.s.navigazione(N.banner('rejected'), { incognito: false });
  await attendi();
  b.incognito = false;
  b.s.navigazione(N.pulizia('finita'), { incognito: true });
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.navigazione.length, 1, 'conta solo quella detta fuori dall’incognito');
  assert.deepEqual(Object.keys(b.per.navigazione[0].doc.bannerCookie), ['rejected']);
  assert.deepEqual(b.per.navigazione[0].doc.navFallite, {});

  b.s.navigazione(N.navFallita(-118, false));
  await attendi();
  b.accesi = false;
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'spenti');
  b.s.navigazione(N.navFallita(-118, false));
  await attendi();
  b.accesi = true;
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.navigazione.length, 1, 'niente di quello che c’era prima dello spegnimento, niente da spenti');
});

test('una navigazione che il server rifiuta riprova il giorno dopo; l’ora già arrivata risponde 409 e non si perde niente', async () => {
  const b = banco();
  let rifiuta = true;
  b.risposta = (dove) => (dove === 'navigazione' && rifiuta ? 403 : 200);
  b.s.navigazione(N.programma('programma', 'domanda'));
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  assert.equal(b.per.ore.length, 1);
  assert.equal(b.per.navigazione.length, 1);
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.navigazione.length, 1, 'rifiutata oggi: non si riprova prima di domani');
  rifiuta = false;
  b.risposta = (dove) => (dove === 'ore' ? 409 : 200);
  b.t += GIORNO;
  await b.s.controlla();
  assert.equal(b.per.navigazione.length, 2);
  assert.equal(b.per.navigazione[1].doc.programmi.programma, '1,0,0,0,0');
  const stato = await b.s.letto();
  assert.deepEqual(Object.keys(stato.ore).filter((k) => k < C.oraDi(b.t)), [], 'arrivata, l’ora lascia il disco');
});

test('all’uscita la pulizia dei cookie è sul disco subito, senza aspettare il salvataggio di dopo', async () => {
  const b = banco();
  await b.s.allUscita(N.pulizia('tetto_2500ms'));
  const ora = b.disco.get(Servizio.CHIAVE).ore[C.oraDi(T0)];
  assert.deepEqual(ora.puliziaCookie, { tetto_2500ms: [1] });
  await b.s.allUscita(null);
  assert.deepEqual(b.disco.get(Servizio.CHIAVE).ore[C.oraDi(T0)].puliziaCookie, { tetto_2500ms: [1] }, 'senza voce salva e basta');
  b.accesi = false;
  await b.s.allUscita(N.pulizia('finita'));
  assert.deepEqual(b.disco.get(Servizio.CHIAVE).ore, {}, 'spenti: non conta, e quello che aspettava si butta');
});

test('una lista già fresca non lascia il giro occupato: l’aggiornamento dopo scarica davvero, e ogni giro si conta', async () => {
  const contati = [];
  globalThis.SN_CONTATORI_MAIN = { navigazione: (v) => contati.push(v) };
  try {
    const A = require(join(ROOT, 'src', 'main', 'services', 'adblock.js'));
    let scaricate = 0;
    const lista = async () => { scaricate += 1; return '||uno.test^\n||due.test^'; };
    assert.equal((await A.refresh({ force: true, sources: ['l'], fetchImpl: lista })).ok, true);
    const fresca = await A.refresh({ sources: ['l'], fetchImpl: lista });
    assert.equal(fresca.skipped, true);
    const forzata = await A.refresh({ force: true, sources: ['l'], fetchImpl: async () => { scaricate += 1; return null; } });
    assert.equal(forzata.skipped, undefined, 'prima rispondeva ancora «già fresca», per sempre');
    assert.equal(forzata.error, 'download_failed');
    assert.equal(scaricate, 2);
    assert.deepEqual(contati.map((v) => v.voci), [['ok', 'g1', 'd1k'], ['saltato', 'g1', 'd1k'], ['download_failed', 'g1', 'd1k']]);
    assert.ok(contati.every((v) => v.misura === 'liste' && v.chiave === 'adblock'));
  } finally {
    delete globalThis.SN_CONTATORI_MAIN;
  }
});
