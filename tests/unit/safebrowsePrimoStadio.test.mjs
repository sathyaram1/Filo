// Unit test — il PRIMO stadio della verifica dei siti pericolosi (#591, sesto
// giro di verifica).
//
// I giri precedenti hanno dato freni, esclusioni e conto ai due stadi PROFONDI
// (il giudizio del modello e la finestra nascosta). Lo stadio che parte prima
// di loro — la ricerca dell'indirizzo nell'elenco dei siti di truffa, su una
// chiave di fabbrica che paga l'owner, più le due domande sull'età del dominio
// a due servizi pubblici — era rimasto come lo descrive la segnalazione:
// «l'unico freno è una cache per host, che si aggira con sottodomini sempre
// nuovi». Quattro cose, che senza la correzione sono tutte rosse:
//
//   1. un freno: duecento sottodomini non fanno duecento richieste;
//   2. un segno «già in volo»: la stessa pagina non si paga due volte, e
//      cinquanta sottodomini non chiedono cinquanta volte l'età dello stesso
//      dominio a un servizio pubblico;
//   3. gli indirizzi della rete di casa non escono di casa — e quello che
//      usciva non era il nome del dispositivo ma l'indirizzo INTERO, con i
//      parametri, che lì sono spesso il codice della sessione;
//   4. in incognito la rete tace, mentre il verdetto locale continua a lavorare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = require_(join(ROOT, 'src/main/services/safebrowse/index.js'));
const { installSafebrowse } = require_(join(ROOT, 'src/main/tabs/tabSafebrowse.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Filo appena aperto, con le chiamate di rete finte e contate.
function banco({ lento = 0 } = {}) {
  const b = { gsb: [], rdap: [], ct: [], llm: [], sandbox: [] };
  for (const c of Object.values(SB._caches)) c.clear();
  for (const v of Object.values(SB._inFlight)) v.clear();
  SB.setProviders({
    gsb: async (url) => { if (lento) await attendi(lento); b.gsb.push(url); return { listed: false }; },
    rdap: async (reg) => { if (lento) await attendi(lento); b.rdap.push(reg); return 400; },
    ct: async (reg) => { if (lento) await attendi(lento); b.ct.push(reg); return { firstSeenDays: 400 }; },
    llm: async (meta) => { b.llm.push(meta); return null; },
    sandbox: async (url) => { b.sandbox.push(url); return null; },
  });
  return b;
}

test('il primo stadio ha un freno: una spruzzata di sottodomini non fa una richiesta a testa', async () => {
  const b = banco();
  for (let i = 0; i < 200; i++) SB.analyze(`http://s${i}.esca-xyz.com/p?u=${i}`, {});
  await attendi(150);
  assert.ok(
    b.gsb.length <= SB.LOOKUP_MAX_PER_OWNER,
    `duecento sottodomini hanno fatto ${b.gsb.length} richieste sulla chiave dell'owner`,
  );
});

test('il freno è di chi possiede il sito, non di tutti', async () => {
  const b = banco();
  // Chi attacca svuota il proprio conto…
  for (let i = 0; i < 60; i++) SB.analyze(`http://s${i}.esca-xyz.com/`, {});
  await attendi(100);
  const prima = b.gsb.length;
  // …e il sito di un altro riceve comunque il suo controllo (subito, o al
  // rinvio che `rimandato` chiede alla scheda).
  const v = SB.analyze('http://un-altro-sito-qualunque.com/', {});
  await attendi(100);
  assert.ok(
    b.gsb.length > prima || v.rimandato === true,
    'il sito di un altro non deve restare senza controllo né senza rinvio',
  );
});

test('la stessa pagina non si paga due volte', async () => {
  const b = banco({ lento: 40 });
  // I due cammini che a ogni navigazione chiedono il verdetto: la scheda che ha
  // finito di navigare e lo script della pagina.
  SB.analyze('http://sito-xyz.com/pagina', {});
  SB.analyze('http://sito-xyz.com/pagina', {});
  await attendi(250);
  assert.equal(b.gsb.length, 1, 'una pagina, una richiesta');
  assert.equal(b.rdap.length, 1, 'una pagina, una domanda sull\'età');
});

test('l\'età dello stesso dominio non si chiede una volta per sottodominio', async () => {
  const b = banco({ lento: 40 });
  for (let i = 0; i < 50; i++) SB.analyze(`http://n${i}.un-dominio-solo-xyz.com/`, {});
  await attendi(300);
  assert.equal(new Set(b.rdap).size, 1, 'il dominio è uno solo');
  assert.equal(b.rdap.length, 1, 'e gli si chiede una volta sola');
  assert.equal(b.ct.length, 1, 'idem per la seconda domanda sull\'età');
});

test('gli indirizzi della rete di casa non escono di casa', async () => {
  const b = banco();
  const casa = [
    'http://192.168.1.1/admin?session=SEGRETO',
    'http://10.0.0.5/setup?token=XYZ',
    'http://172.16.4.2/status',
    'http://127.0.0.1:3000/mia-app?chiave=privata',
    'http://localhost:8080/',
    'http://mio-nas.local/files?doc=bilancio',
    'http://stampante.lan/',
  ];
  for (const u of casa) SB.analyze(u, {});
  await attendi(150);
  assert.deepEqual(b.gsb, [], 'l\'indirizzo intero di una pagina di casa non deve uscire');
  assert.deepEqual(b.rdap, [], 'nemmeno il nome della macchina di casa');
  assert.deepEqual(b.ct, [], 'nemmeno alla seconda domanda sull\'età');
  assert.deepEqual(b.llm, [], 'gli stadi profondi quell\'esclusione ce l\'avevano già');
  assert.deepEqual(b.sandbox, []);
});

test('in incognito la rete tace e il verdetto locale resta acceso', async () => {
  const b = banco();
  const v = SB.analyze('https://paypa1-sicurezza-conto.com/login?u=mario', { incognito: true });
  await attendi(150);
  assert.deepEqual(b.gsb, [], 'in incognito Filo si astiene da tutto il resto: anche da qui');
  assert.deepEqual(b.rdap, []);
  assert.deepEqual(b.ct, []);
  assert.equal(b.llm.length + b.sandbox.length, 0);
  assert.notEqual(v.level, 'safe', 'il controllo locale non manda niente a nessuno e resta acceso');
});

test('la scheda dice al controllo se è in incognito, e non si fida della pagina', () => {
  const visti = [];
  const precedente = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = {
    analyze: (_url, ctx) => { visti.push(ctx); return { level: 'safe', message: null, norm: null }; },
    normalize: () => null,
    proprietario: (h) => h,
  };
  try {
    class FintoTabManager {}
    installSafebrowse(FintoTabManager);
    const tab = { id: 1, view: { webContents: { send() {} } } };

    const incognita = new FintoTabManager();
    incognita.incognito = true;
    incognita.tabs = [tab];
    incognita._sbOnNavigate(tab, 'https://sito-xyz.com/a?q=privato');
    // Il contesto arriva dallo script della pagina: non è fidato.
    incognita.safebrowseGet(1, 'https://sito-xyz.com/a?q=privato', { incognito: false });

    const normale = new FintoTabManager();
    normale.incognito = false;
    normale.tabs = [tab];
    normale._sbOnNavigate(tab, 'https://sito-xyz.com/a');

    assert.equal(visti.length, 3);
    assert.equal(visti[0].incognito, true);
    assert.equal(visti[1].incognito, true, 'la scheda decide, non la pagina');
    assert.equal(visti[2].incognito, false);
  } finally {
    globalThis.SN_SAFEBROWSE = precedente;
  }
});

test('la ricerca nell\'elenco dei siti di truffa ha un nome leggibile nella pagina dei costi', () => {
  require_(join(ROOT, 'src/shared/constants.js'));
  const C = globalThis.SN_CONST;
  const id = C.SERVIZI.SAFE_BROWSING;
  assert.notEqual(C.actionLabel(id), id, 'mostrerebbe il suo codice grezzo');
  assert.equal(C.creditUsageGroup(id), 'Siti pericolosi');
});

test('la ricerca nell\'elenco dei siti di truffa passa dal cancello unico', () => {
  // Il cancello è l'unico posto da cui si raggiunge un fornitore, e questa
  // chiamata si paga sulla chiave di fabbrica dell'owner: deve arrivare a
  // safebrowse INIETTATA da chi è passato di lì, non costruita qui dentro.
  const chiamate = [];
  SB.configure({
    gsbKey: 'una-chiave',
    runGsb: async (url) => { chiamate.push(url); return { listed: false }; },
    runLlm: null,
    enableSandbox: false,
    enableNetwork: false,
  });
  for (const c of Object.values(SB._caches)) c.clear();
  for (const v of Object.values(SB._inFlight)) v.clear();
  SB.analyze('http://sito-da-verificare-xyz.com/p', {});
  assert.equal(chiamate.length, 1, 'la richiesta deve passare da chi la fa contare');
});
