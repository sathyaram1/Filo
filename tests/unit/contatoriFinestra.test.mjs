// I contatori della finestra (#1470): elenchi chiusi, fasce e documento (src/shared/contatoriFinestra.js), le misure del
// main (src/main/services/contatoriFinestra.js) e la spedizione del terzo documento dell'ora col servizio vero, su
// disco, orologio e rete finti. Niente esce fuori dagli elenchi: un disco manomesso non arriva al server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriFinestra']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const Misure = require(join(ROOT, 'src', 'main', 'services', 'contatoriFinestra.js'));
const C = globalThis.SN_CONTATORI;
const F = globalThis.SN_CONTATORI_FINESTRA;

const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const MIN = 60 * 1000;
const ORA = 60 * MIN;
const GIORNO = 24 * ORA;
const T0 = new Date(2026, 9, 22, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ schede = [{ id: 'a', openedAt: new Date(T0 - 2 * MIN).toISOString() }], finestre = 1, ambiente = null, risposta = 200 } = {}) {
  const disco = new Map();
  const per = {};
  const b = { t: T0, accesi: true, incognito: false, risposta, disco, per, n: 0, schede, finestre, ambiente };
  b.s = Servizio.crea({
    contatori: C,
    contatoriFinestra: F,
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
    piattaforma: 'win32',
    esclusi: async () => [],
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    fetch: async (url, opt) => {
      const coll = /documents\/([a-z-]+)\?/.exec(url)[1];
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      (per[coll] || (per[coll] = [])).push({ url, doc });
      const st = typeof b.risposta === 'function' ? b.risposta(coll, doc) : b.risposta;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
    },
    log: () => {},
  });
  b.m = Misure.crea({
    contatori: b.s, adesso: () => b.t, segui: false,
    finestreNormali: () => Array.from({ length: b.finestre }, (_, i) => ({ _filoTabs: { tabs: i === 0 ? b.schede : [] } })),
    ambiente: () => b.ambiente,
  });
  return b;
}
const oraIn = async (b) => {
  await attendi();
  const s = await b.s.letto();
  return s.ore[C.oraDi(b.t)];
};

test('le fasce dicono dove cade un numero, ai bordi compresi', () => {
  const f = (fasce, v) => F.fasciaIn(fasce, v);
  assert.deepEqual([1, 2, 5, 6, 10, 11, 20, 21, 50, 51].map((n) => f(F.FASCE_SCHEDE, n)), ['n1', 'n2_5', 'n2_5', 'n6_10', 'n6_10', 'n11_20', 'n11_20', 'n21_50', 'n21_50', 'oltre']);
  assert.deepEqual([1, 2, 3].map((n) => f(F.FASCE_FINESTRE, n)), ['n1', 'n2', 'n3_oltre']);
  assert.deepEqual([MIN, MIN + 1, 10 * MIN, ORA, 8 * ORA, GIORNO, GIORNO + 1].map((n) => f(F.FASCE_ETA, n)), ['m1', 'm10', 'm10', 'h1', 'h8', 'g1', 'oltre']);
  assert.deepEqual([0, 1, 2, 5, 6].map((n) => f(F.FASCE_ARCHIVIATE, n)), ['n0', 'n1', 'n2_5', 'n2_5', 'oltre']);
  assert.deepEqual([1, 2, 3, 4, 10, 11].map((n) => f(F.FASCE_DISTANZA, n)), ['d1', 'd2_3', 'd2_3', 'd4_10', 'd4_10', 'oltre']);
  assert.deepEqual([1024, 1025, 1366, 1600, 1920, 1921].map((n) => f(F.FASCE_LARGHEZZA, n)), ['w1024', 'w1366', 'w1366', 'w1600', 'w1920', 'oltre']);
  assert.equal(f(F.FASCE_SOSTA, -1), '');
  assert.equal(f(F.FASCE_SOSTA, 'x'), '');
  assert.deepEqual([1, 1.25, 1.5, 2, 1.75, 3].map(F.scalaDi), ['1', '1_25', '1_5', '2', 'altro', 'altro']);
  assert.deepEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [9, 4]].map(([c, n]) => F.quotaDi(Math.min(c, n), n)), ['zero', 'q25', 'q50', 'q75', 'q100', 'q100']);
  assert.equal(F.ambienteDi({ larghezza: 1280, scala: 1.25, stato: 'normale', scuro: false }), 'w1366:1_25:normale:chiaro');
  assert.equal(F.ambienteDi({ larghezza: 1280, scala: 1, stato: 'ridotta' }), '', 'uno stato fuori elenco non esce');
});

test('ogni registrazione resta negli elenchi chiusi: il fuori elenco diventa «altro» o non entra', () => {
  const ora = {};
  assert.equal(F.registraChiusura(ora, 'pulsante_x', 30 * 1000), true);
  assert.equal(F.registraChiusura(ora, 'una via inventata', 2 * ORA), true);
  assert.equal(F.registraChiusura(ora, 'ctrl_w', null), false, 'senza età non si conta');
  assert.equal(F.registraVoceMenu(ora, 'tab-proxy-go:us'), false, 'il paese scelto non esce');
  assert.equal(F.registraVoceMenu(ora, 'tab-mute'), true);
  assert.equal(F.registraNotifica(ora, 'download_finito', 'azione_1', { letta: true }), true);
  assert.equal(F.registraNotifica(ora, 'Scaricato: foto.jpg', 'chiusa_x'), true);
  assert.equal(F.registraNotifica(ora, 'sito_bloccato', 'azione_7'), true);
  assert.equal(F.registraNotifica(ora, 'sito_bloccato', 'esplosa'), false);
  assert.equal(F.registraNotifica(ora, 'crediti_finiti', 'scaduta', { inAttesa: true }), true, 'gli avvisi d’errore hanno già il loro tipo');
  assert.equal(F.registraGiroRiordino(ora, 'idle', { duplicati: 0, modello: 3, giudizioMancato: true }), true);
  assert.equal(F.registraGiroRiordino(ora, 'manual', { giaInCorso: true }), true);
  assert.equal(F.registraGiroRiordino(ora, 'quando-vuoi', {}), false);
  assert.equal(F.registraDownload(ora, 'pannello', 'apri_file'), true);
  assert.equal(F.registraDownload(ora, 'desktop', 'apri_file'), false);
  assert.equal(F.registraDownload(ora, 'pagina', 'esegui'), false);
  assert.equal(F.registraTrascinata(ora, 0), false, 'uno spostamento nullo non è uno spostamento');
  assert.equal(F.registraAnteprima(ora, 'pronta', 'via', 300), true);
  assert.equal(F.registraSessione(ora, 12, 9), true);
  const d = ora.finestra;
  assert.deepEqual(d.chiusuraScheda, { 'pulsante_x:m1': 1, 'altro:h8': 1 });
  assert.deepEqual(d.voceMenuScheda, { 'tab-mute': 1 });
  assert.deepEqual(d.notifica, {
    'download_finito:azione_1': 1, 'download_finito:letta': 1, 'altro:chiusa_x': 1, 'sito_bloccato:azione_2': 1,
    'crediti_finiti:scaduta': 1, 'crediti_finiti:in_attesa': 1,
  });
  assert.deepEqual(d.riordinoAutomatico, { 'idle:duplicato:n0': 1, 'idle:modello:n2_5': 1, 'idle:giudizio_mancato': 1, 'manual:gia_in_corso': 1 });
  assert.deepEqual(d.sessioneRipristinata, { 'n11_20:q75': 1 });
  assert.deepEqual(d.anteprimaScheda, { 'pronta:via:ms500': 1 });
});

test('il documento si ricostruisce dagli elenchi: quello che il disco ha in più non parte', () => {
  const ora = {};
  F.registraSchede(ora, 7, 2);
  F.registraSchede(ora, 3, 1);
  F.registraAmbiente(ora, { larghezza: 1920, scala: 2, stato: 'schermo_intero', scuro: true });
  F.registraChiusura(ora, 'chat', 5 * MIN);
  ora.finestra.notifica['<script>alert(1)</script>:chiusa_x'] = 4;
  ora.finestra.notifica['download_finito:azione_0'] = 2.5;
  ora.finestra.chiusuraScheda['https://youtube.com:m1'] = 1;
  ora.finestra.titolo = 'Le mie ricerche';
  const doc = F.documento({ pseudonimo: 'b'.repeat(20), chiave: '2026-10-22T09', app: '0.2.249', os: 'win', dati: ora });
  assert.deepEqual(Object.keys(doc), [...F.CAMPI]);
  assert.equal(doc.schedeAperte, 'n6_10:n2', 'il massimo dell’ora, non l’ultimo');
  assert.equal(doc.ambienteFinestra, 'w1920:2:schermo_intero:scuro');
  assert.deepEqual(doc.chiusuraScheda, { 'chat:m10': '1' });
  assert.deepEqual(doc.notifica, {});
  assert.equal(F.valida(doc).ok, true, F.valida(doc).motivo);
  assert.equal(F.senzaDati(doc), false);
  ora.finestra.ambiente = 'la mia scrivania';
  assert.equal(F.documento({ pseudonimo: 'b'.repeat(20), chiave: '2026-10-22T09', app: '0.2.249', os: 'win', dati: ora }).ambienteFinestra, '');
  assert.equal(F.valida({ ...doc, notifica: { 'mario:chiusa_x': '1' } }).ok, false, 'un tipo fuori elenco non passa la validazione dell’app');
  assert.equal(F.valida({ ...doc, extra: 1 }).ok, false);
  const vuoto = F.documento({ pseudonimo: 'b'.repeat(20), chiave: '2026-10-22T09', app: '0.2.249', os: 'win', dati: { finestra: 'rotto' } });
  assert.equal(F.senzaDati(vuoto), true);
});

test('l’ora con la finestra parte col terzo documento, stesso id; una senza no', async () => {
  const b = banco({ ambiente: { larghezza: 1366, scala: 1.25, stato: 'massimizzata', scuro: false } });
  b.m.voceMenu('tab-help');
  b.m.chiusa({ openedAt: new Date(T0 - 3 * MIN).toISOString() }, 'clic_centrale');
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  const [ora] = b.per[C.COLLEZIONE];
  const [fin] = b.per[F.COLLEZIONE];
  assert.equal(C.idDocumento(fin.doc), C.idDocumento(ora.doc), 'lo stesso id dell’ora');
  assert.ok(fin.url.includes(`documentId=${encodeURIComponent(C.idDocumento(ora.doc))}`));
  assert.equal(fin.doc.schedeAperte, 'n1:n1');
  assert.equal(fin.doc.ambienteFinestra, 'w1366:1_25:massimizzata:chiaro');
  assert.deepEqual(fin.doc.voceMenuScheda, { 'tab-help': '1' });
  assert.deepEqual(fin.doc.chiusuraScheda, { 'clic_centrale:m10': '1' });
  assert.equal(F.valida(fin.doc).ok, true);

  // Senza finestre normali né misure, l'ora parte senza il terzo documento.
  const c = banco({ finestre: 0 });
  await c.s.finestra(() => true);
  await attendi();
  c.t += ORA;
  assert.equal(await c.s.controlla(), 'inviati');
  assert.equal((c.per[C.COLLEZIONE] || []).length, 1);
  assert.equal(c.per[F.COLLEZIONE], undefined);
});

test('il terzo documento rifiutato (regole non ancora pubblicate) tiene l’ora in attesa, e il giorno dopo parte', async () => {
  const b = banco({ risposta: (coll) => (coll === F.COLLEZIONE ? 403 : 200) });
  b.m.voceMenu('tab-duplicate');
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  let s = await b.s.letto();
  assert.equal(Object.keys(s.ore).length, 1, 'l’ora resta');
  b.risposta = (coll) => (coll === C.COLLEZIONE ? 409 : 200);
  b.t += GIORNO;
  assert.equal(await b.s.controlla(), 'inviati');
  s = await b.s.letto();
  assert.deepEqual(Object.keys(s.ore).filter((k) => k < C.oraDi(b.t)), []);
  assert.equal(b.per[F.COLLEZIONE].length, 2);
  assert.deepEqual(b.per[F.COLLEZIONE][1].doc.voceMenuScheda, { 'tab-duplicate': '1' });
});

test('in incognito e a contatori spenti la finestra non conta niente', async () => {
  const b = banco();
  b.incognito = true;
  b.m.voceMenu('tab-mute');
  b.m.notifica('sito_bloccato', 'chiusa_x');
  await attendi();
  assert.equal(await oraIn(b), undefined);
  b.incognito = false;
  b.m.chiusa({ openedAt: new Date(T0).toISOString() }, 'pulsante_x', { incognito: true });
  b.m.trascinata({ incognito: true }, 2);
  b.m.anteprima('pronta', 'via', 100, { incognito: true });
  b.m.schede({ incognito: true });
  await attendi();
  assert.equal(await oraIn(b), undefined);
  b.accesi = false;
  b.m.voceMenu('tab-mute');
  await attendi();
  assert.equal(await oraIn(b), undefined);
});

test('le schede: si scrive solo quando il massimo cresce o cambia l’ora', async () => {
  const b = banco();
  let scritture = 0;
  const vera = b.s.finestra;
  b.s.finestra = (...a) => { scritture += 1; return vera(...a); };
  const m = Misure.crea({ contatori: b.s, adesso: () => b.t, segui: false, finestreNormali: () => [{ _filoTabs: { tabs: b.schede } }], ambiente: () => null });
  m.schede();
  m.schede();
  m.schede();
  assert.equal(scritture, 1);
  b.schede = [...b.schede, { id: 'b' }, { id: 'c' }];
  m.schede();
  b.schede = b.schede.slice(0, 1);
  m.schede();
  assert.equal(scritture, 2, 'una scheda chiusa non abbassa il massimo e non scrive');
  b.t += ORA;
  m.schede();
  assert.equal(scritture, 3, 'l’ora nuova ha il suo massimo');
  await attendi();
  const s = await b.s.letto();
  const ore = Object.values(s.ore).map((o) => o.finestra.schede);
  assert.deepEqual(ore, [3, 1]);
});

test('riordino: lo spostamento a mano entro un minuto lo disfa; la riapertura dall’archivio solo se l’aveva chiusa lui', async () => {
  const b = banco();
  const tm = { incognito: false };
  b.m.trascinata(tm, 1);
  b.m.riordinatoPerColore(tm);
  b.t += 30 * 1000;
  b.m.trascinata(tm, 4);
  b.t += 31 * 1000;
  b.m.trascinata(tm, 12);
  b.m.riapertaDallArchivio({ reason: 'manual', closedAt: new Date(T0).toISOString() });
  b.m.riapertaDallArchivio({ reason: 'duplicato', closedAt: new Date(b.t - 30 * MIN).toISOString() });
  b.m.riapertaDallArchivio({ reason: 'pagina già letta', closedAt: 'ieri' });
  const ora = await oraIn(b);
  assert.deepEqual(ora.finestra.schedaTrascinata, { d1: 1, d4_10: 1, oltre: 1 });
  assert.deepEqual(ora.finestra.riordinoAutomatico, { spostata_a_mano: 1, 'riaperta:h1': 1 });
});

test('la sessione ripristinata: quante schede tornano e quante l’utente ne chiude nei primi minuti', async () => {
  const b = banco();
  const tm = { incognito: false };
  const nate = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, openedAt: new Date(T0 - GIORNO).toISOString() }));
  b.m.sessione(tm, nate);
  b.m.chiusa(nate[0], 'pulsante_x');
  b.m.chiusa(nate[1], 'riordino_automatico');
  b.m.chiusa(nate[2], 'chat');
  b.m.chiusa(nate[3], 'ctrl_w');
  b.t += F.PRESTO_MS + 1;
  b.m.chiusa(nate[4], 'ctrl_w');
  b.m.allUscita();
  b.m.allUscita();
  const ora = await oraIn(b);
  assert.deepEqual(ora.finestra.sessioneRipristinata, { 'n6_10:q25': 1 }, 'due chiuse a mano su otto, il riordino non conta');
  assert.equal(b.m.sessione({ incognito: true }, nate), null);
  assert.equal(b.m.sessione(tm, []), null);
});
