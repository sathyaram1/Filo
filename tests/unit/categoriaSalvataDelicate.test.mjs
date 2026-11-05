// #1545 — salvare per dopo con la categorizzazione accesa: di una pagina delicata al modello va solo il tipo, dalla
// rete di casa e dall'incognito niente, una pagina normale come prima. Montato sugli handler veri di pages.js, col
// categorizzatore, il filtro delle pagine delicate e il prompt veri; finto solo il modello.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
globalThis.self = globalThis;
for (const m of ['messages', 'constants', 'contenutoEsterno', 'urlNav', 'pagineDelicate']) require(join(SRC, 'shared', `${m}.js`));
const MSG = globalThis.SN_MSG.MSG;
const disco = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => ({ [k]: disco[k] }),
      set: async (o) => { Object.assign(disco, JSON.parse(JSON.stringify(o))); },
    },
  },
};
globalThis.SN_STORAGE = { getRaw: async (_k, d) => d, setRaw: async () => {}, getSettings: async () => ({}) };
require(join(SRC, 'main', 'services', 'pagineDelicate.js'));
require(join(SRC, 'main', 'services', 'categorizer.js'));
const { categorizza } = require(join(SRC, 'main', 'services', 'categoriaSalvata.js'));
const PROMPTS = globalThis.SN_CONST.PROMPTS;
const KEY = globalThis.SN_CONST.STORAGE_KEYS.SAVED_PAGES;

const TITOLO = 'Posta in arrivo (3) - mario.rossi@gmail.com';
const ESTRATTO = 'Saldo disponibile 12.345,67 euro. IBAN IT60X0542811101000000123456';
const DESCRIZIONE = 'Le tue email di Gmail';

// Salva una pagina come fa il tasto destro (SAVE_PAGE) o un link (SAVE_LINK), e aspetta la categoria.
async function salva({ settings = {}, incognito = false, tipo = MSG.SAVE_PAGE, page }) {
  for (const k of Object.keys(disco)) delete disco[k];
  const chiamate = [];
  const pagine = [];
  globalThis.SN_SAVED_PAGES = {
    list: async () => (disco[KEY] || pagine),
    save: async (p) => { const e = { id: 'p1', url: p.url, title: p.title || p.url, thumbnail: '' }; pagine.push(e); return e; },
  };
  const chiedi = async ({ action, payload, origin }) => {
    chiamate.push({ action, payload, origin, prompt: PROMPTS.categorize(payload) });
    return { text: '{"category":"Comunicazioni","confidence":0.9,"isNew":true}' };
  };
  let lavoro = Promise.resolve();
  const registro = new Map();
  const percorso = join(SRC, 'main', 'services', 'handlers', 'pages.js');
  delete require.cache[percorso];
  require(percorso)((t, fn) => registro.set(t, fn), {
    MSG,
    maybeCategorizeAsync: (voce, pagina) => (lavoro = categorizza(voce, pagina, { settings, chiedi, inIncognito: () => incognito })),
  });
  const msg = tipo === MSG.SAVE_PAGE ? { type: tipo, page } : { type: tipo, url: page.url, title: page.title };
  await registro.get(tipo)(msg, null, 'filo://newtab/');
  await lavoro;
  return { chiamate, voce: (disco[KEY] || pagine).find((p) => p.id === 'p1') };
}

const posta = { url: 'https://mail.google.com/mail/u/0/#inbox', title: TITOLO, description: DESCRIZIONE, excerpt: ESTRATTO };

test('una pagina di posta salvata: al modello va il tipo, non indirizzo, titolo, descrizione né estratto, e la categoria arriva', async () => {
  const { chiamate, voce } = await salva({ page: posta });
  assert.equal(chiamate.length, 1, 'una pagina delicata si categorizza lo stesso, col solo tipo');
  const { prompt, payload, origin } = chiamate[0];
  assert.match(prompt, /posta/);
  for (const segreto of ['mail.google.com', 'mario.rossi', 'Posta in arrivo', 'IBAN', '12.345', DESCRIZIONE]) {
    assert.ok(!prompt.includes(segreto), `al modello arriva «${segreto}»: ${prompt}`);
    assert.ok(!JSON.stringify(payload).includes(segreto), `nel payload resta «${segreto}»`);
  }
  assert.equal(origin, '', 'l\'indirizzo non va nemmeno nell\'origine della chiamata');
  assert.equal(voce.category, 'Comunicazioni');
});

test('un link a una banca salvato dal menu: anche lì solo il tipo', async () => {
  const { chiamate } = await salva({ tipo: MSG.SAVE_LINK, page: { url: 'https://www.intesasanpaolo.com/conto', title: 'Il mio conto corrente' } });
  assert.equal(chiamate.length, 1);
  assert.match(chiamate[0].prompt, /banca/);
  assert.ok(!chiamate[0].prompt.includes('intesasanpaolo') && !chiamate[0].prompt.includes('Il mio conto'));
});

test('una pagina della rete di casa non parte verso il modello, nemmeno a regola delle delicate spenta', async () => {
  for (const settings of [{}, { security: { pagineDelicate: { enabled: false } } }]) {
    const { chiamate, voce } = await salva({ settings, page: { url: 'http://192.168.1.1/', title: 'Router TIM', excerpt: 'Password Wi-Fi: segreta' } });
    assert.equal(chiamate.length, 0);
    assert.ok(voce, 'la pagina resta salvata');
    assert.ok(!voce.category);
  }
});

test('una pagina normale manda titolo ed estratto come prima', async () => {
  const { chiamate, voce } = await salva({ page: { url: 'https://it.wikipedia.org/wiki/Torino', title: 'Torino - Wikipedia', excerpt: 'Torino è un comune italiano' } });
  assert.equal(chiamate.length, 1);
  assert.match(chiamate[0].prompt, /Torino - Wikipedia/);
  assert.match(chiamate[0].prompt, /comune italiano/);
  assert.equal(chiamate[0].origin, 'https://it.wikipedia.org/wiki/Torino');
  assert.equal(voce.category, 'Comunicazioni');
});

test('con le pagine delicate spente la posta va al modello come oggi', async () => {
  const { chiamate } = await salva({ settings: { security: { pagineDelicate: { enabled: false } } }, page: posta });
  assert.equal(chiamate.length, 1);
  assert.match(chiamate[0].prompt, /Posta in arrivo/);
  assert.match(chiamate[0].prompt, /IBAN/);
});

test('un sito aggiunto dall\'utente fra i delicati vale come la posta', async () => {
  const settings = { security: { pagineDelicate: { siti: ['studiorossi.it'] } } };
  const { chiamate } = await salva({ settings, page: { url: 'https://area.studiorossi.it/pratiche', title: 'Pratica 730 di Mario', excerpt: 'Reddito' } });
  assert.equal(chiamate.length, 1);
  assert.ok(!chiamate[0].prompt.includes('studiorossi') && !chiamate[0].prompt.includes('Pratica 730'));
});

test('da una finestra in incognito la categorizzazione non parte', async () => {
  for (const page of [posta, { url: 'https://it.wikipedia.org/wiki/Torino', title: 'Torino', excerpt: 'x' }]) {
    const { chiamate } = await salva({ incognito: true, page });
    assert.equal(chiamate.length, 0, page.url);
  }
});
