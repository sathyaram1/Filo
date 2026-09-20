// Verifica #591 — giro 6. Cosa si porta dietro il PRIMO stadio della verifica
// dei siti pericolosi.
//
// Il giro 5 ha guardato COSA si porta dietro una chiamata che parte da sola, e
// ha chiuso la porta sul riconoscimento del blocco geografico (indirizzi della
// rete di casa, finestre in incognito). La stessa domanda, sullo stadio che
// parte prima del giudizio del modello, dava la risposta opposta: quello stadio
// manda fuori l'indirizzo INTERO, percorso e parametri compresi, e non aveva né
// l'esclusione della rete di casa (che gli stadi profondi hanno dal giro 2) né
// l'astensione in incognito (che la funzione gemella ha dal giro 5).
//
// Logica pura: le chiamate di rete sono finte. L'ultima prova monta i metodi
// veri della scheda su un oggetto finto, per chiedere alla scheda in incognito
// se lo dice al controllo.

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
  for (const v of Object.values(SB._inFlight)) v.clear();
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

test('gli indirizzi della rete di casa non escono di casa', async () => {
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

test('in incognito non esce niente della pagina', async () => {
  const b = banco();
  SB.analyze('https://pagina-in-incognito-xyz.com/qualcosa?q=privato', { incognito: true });
  await attendi(200);
  expect(b.gsb, 'in incognito Filo si astiene da tutto il resto: anche da qui').toEqual([]);
  expect(b.rdap, 'nemmeno il nome del sito').toEqual([]);
  expect(b.ct, 'nemmeno alla seconda domanda').toEqual([]);
  expect(b.llm.length + b.sandbox.length, 'e nemmeno gli stadi profondi').toBe(0);
});

test('in incognito il verdetto locale continua a lavorare', async () => {
  banco();
  const v = SB.analyze('https://paypa1-sicurezza-conto.com/login', { incognito: true });
  expect(v && v.level, 'il controllo che non manda niente a nessuno resta acceso')
    .not.toBe('safe');
});

test('la scheda in incognito lo dice al controllo', async () => {
  const visti = [];
  const precedente = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = {
    analyze: (url, ctx) => { visti.push(ctx); return { level: 'safe', message: null, norm: null }; },
    normalize: () => null,
    proprietario: (h) => h,
  };
  try {
    class SchedaFinta {}
    installSafebrowse(SchedaFinta);
    const tab = { id: 1, view: { webContents: { send() {} } } };

    const incognita = new SchedaFinta();
    incognita.incognito = true;
    incognita.tabs = [tab];
    incognita._sbOnNavigate(tab, 'https://pagina-xyz.com/a?q=privato');
    incognita.safebrowseGet(1, 'https://pagina-xyz.com/a?q=privato', { incognito: false });

    const normale = new SchedaFinta();
    normale.incognito = false;
    normale.tabs = [tab];
    normale._sbOnNavigate(tab, 'https://pagina-xyz.com/a');

    expect(visti.length).toBe(3);
    expect(visti[0].incognito, 'la scheda in incognito lo dice').toBe(true);
    expect(visti[1].incognito,
      'e non si fida di quello che le manda lo script della pagina').toBe(true);
    expect(visti[2].incognito, 'una scheda normale no').toBe(false);
  } finally {
    globalThis.SN_SAFEBROWSE = precedente;
  }
});
