// Verifica #591 — giro 6. Cosa si porta dietro il PRIMO stadio della verifica
// dei siti pericolosi.
//
// Il giro 5 ha guardato COSA si porta dietro una chiamata che parte da sola, e
// ha chiuso la porta sul riconoscimento del blocco geografico (indirizzi della
// rete di casa, finestre in incognito). La stessa domanda, sullo stadio che
// parte prima del giudizio del modello, dà la risposta opposta: quello stadio
// manda fuori l'indirizzo INTERO — percorso e parametri compresi — e non ha né
// l'esclusione della rete di casa (che gli stadi profondi hanno dal giro 2) né
// l'astensione in incognito (che la funzione gemella ha dal giro 5).
//
// Logica pura: le chiamate di rete sono finte. L'ultima prova monta i metodi
// veri della scheda su un oggetto finto, per chiedere alla scheda in incognito
// se si astiene.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const { installSafebrowse } = require_(join(REPO, 'src/main/tabs/tabSafebrowse.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

function banco() {
  const b = { gsb: [], rdap: [], ct: [], llm: [], sandbox: [] };
  for (const c of Object.values(SB._caches)) c.clear();
  SB._inFlight.llm.clear();
  SB._inFlight.sandbox.clear();
  SB.setProviders({
    gsb: async (url) => { b.gsb.push(url); return { listed: false }; },
    rdap: async (reg) => { b.rdap.push(reg); return 400; },
    ct: async (reg) => { b.ct.push(reg); return { firstSeenDays: 400 }; },
    llm: async (meta) => { b.llm.push(meta); return null; },
    sandbox: async (url) => { b.sandbox.push(url); return null; },
  });
  return b;
}

// Gli stessi indirizzi con cui i giri 2 e 5 hanno chiuso le altre due porte.
const CASA = [
  'http://192.168.1.1/admin?session=SEGRETO-ABC',
  'http://10.0.0.5/setup?token=XYZ',
  'http://172.16.4.2/status',
  'http://127.0.0.1:3000/mia-app?chiave=privata',
  'http://localhost:8080/',
  'http://mio-nas.local/files?doc=bilancio-famiglia',
  'http://stampante.lan/',
];

test('gli indirizzi della rete di casa escono di casa lo stesso', async () => {
  const b = banco();
  for (const u of CASA) SB.analyze(u, {});
  await attendi(200);
  expect(b.gsb, 'nessun indirizzo della rete di casa deve uscire').toEqual([]);
  expect(b.rdap, 'nemmeno il nome della macchina di casa').toEqual([]);
  expect(b.ct, 'nemmeno alla seconda domanda sull\'età').toEqual([]);
});

test('caso di riscontro: gli stadi profondi quell\'esclusione ce l\'hanno', async () => {
  const b = banco();
  for (const u of CASA) SB.analyze(u, {});
  await attendi(200);
  expect(b.llm, 'il giudizio del modello sta alla larga dalla rete di casa').toEqual([]);
  expect(b.sandbox, 'e la finestra nascosta pure').toEqual([]);
});

test('di ogni pagina esce l\'indirizzo intero, con i suoi parametri', async () => {
  const b = banco();
  SB.analyze('https://ospedale-esempio-xyz.it/referti/12345?paziente=mario.rossi&token=abc', {});
  await attendi(200);
  const uscito = b.gsb[0] || '';
  expect(uscito.includes('paziente=mario.rossi'),
    `fuori è andato l'indirizzo intero: ${uscito}`).toBe(false);
});

test('esce anche l\'indirizzo delle pagine dei siti fidati', async () => {
  const b = banco();
  SB.analyze('https://www.google.com/search?q=una+ricerca+imbarazzante', {});
  SB.analyze('https://wikipedia.org/wiki/Una_malattia', {});
  await attendi(200);
  expect(b.gsb,
    'un sito nella lista dei fidati non ha niente da verificare').toEqual([]);
});

test('in incognito la scheda non si astiene', async () => {
  const chiamate = [];
  const precedente = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = {
    analyze: (url) => { chiamate.push(url); return { level: 'safe', message: null, norm: null }; },
    normalize: () => null,
    proprietario: (h) => h,
  };
  try {
    class SchedaFinta {}
    installSafebrowse(SchedaFinta);
    const scheda = new SchedaFinta();
    scheda.incognito = true;
    scheda.tabs = [];
    const tab = { id: 1, view: { webContents: { send() {} } } };
    scheda._sbOnNavigate(tab, 'https://pagina-in-incognito-xyz.com/qualcosa?q=privato');
    expect(chiamate,
      'in incognito Filo si astiene da tutto il resto: qui no').toEqual([]);
  } finally {
    globalThis.SN_SAFEBROWSE = precedente;
  }
});

test('caso di riscontro: fuori dall\'incognito la stessa navigazione parte', async () => {
  const chiamate = [];
  const precedente = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = {
    analyze: (url) => { chiamate.push(url); return { level: 'safe', message: null, norm: null }; },
    normalize: () => null,
    proprietario: (h) => h,
  };
  try {
    class SchedaFinta2 {}
    installSafebrowse(SchedaFinta2);
    const scheda = new SchedaFinta2();
    scheda.incognito = false;
    scheda.tabs = [];
    const tab = { id: 1, view: { webContents: { send() {} } } };
    scheda._sbOnNavigate(tab, 'https://pagina-normale-xyz.com/qualcosa');
    expect(chiamate.length, 'in una finestra normale il controllo deve partire').toBe(1);
  } finally {
    globalThis.SN_SAFEBROWSE = precedente;
  }
});
