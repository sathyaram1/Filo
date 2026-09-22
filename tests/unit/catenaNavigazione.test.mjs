// Unit test — la catena di navigazioni, cioè CHI consuma i controlli che Filo
// fa partire da solo mentre si naviga (#591, settimo giro).
//
// I freni dei giri passati limitavano la velocità e non il totale: il conto
// comune si riapriva ogni pochi secondi e quello per sito si aggira con
// sotto-indirizzi gratuiti, dove ognuno vale come un proprietario diverso. In
// sedici secondi una pagina che si porta da sola in giro faceva partire
// trentadue giudizi del modello, trentadue finestre nascoste e quarantotto
// ricerche nell'elenco dei siti di truffa, e non calava mai: quasi seimila
// chiamate all'ora sulla chiave condivisa, cioè il tetto mensile svuotato in
// una notte e tutta l'AI di Filo spenta per il resto del mese.
//
// Senza la correzione queste prove sono rosse:
//   1. una catena ha un conto piccolo che non si riapre finché dura;
//   2. chi naviga dopo una pausa apre una catena nuova, col conto intero, così
//      alla truffa che l'utente raggiunge da sé non si toglie niente;
//   3. le due schede lo dichiarano davvero (verifica dei siti pericolosi e
//      riconoscimento del blocco geografico): il conto lo può tenere solo chi
//      sa da dove viene la navigazione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = require_(join(ROOT, 'src/main/services/safebrowse/index.js'));
const GEO = require_(join(ROOT, 'src/main/services/geoBlockClassifier.js'));
const { catenaDi, PAUSA_MS } = require_(join(ROOT, 'src/main/tabs/catenaNavigazione.js'));
const { installSafebrowse } = require_(join(ROOT, 'src/main/tabs/tabSafebrowse.js'));
const { installGeoBlock } = require_(join(ROOT, 'src/main/tabs/tabGeoBlock.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

function banco() {
  const b = { gsb: [], llm: [], sandbox: [] };
  for (const c of Object.values(SB._caches)) c.clear();
  for (const v of Object.values(SB._inFlight)) v.clear();
  SB.setProviders({
    gsb: async (u) => { b.gsb.push(u); return { listed: false }; },
    rdap: async () => 400,
    ct: async () => null,
    llm: async (m) => { b.llm.push(m); return null; },
    sandbox: async (u) => { b.sandbox.push(u); return null; },
  });
  return b;
}

// Una pagina ostile: sotto-indirizzi gratuiti sempre nuovi, ciascuno un
// proprietario diverso, con un nome che imita un marchio.
function esca(i) { return `paypa1-accesso-${i}.pages.dev`; }

test('la catena è la stessa finché la pagina non lascia respirare, e una pausa ne apre una nuova', () => {
  const tab = { id: 7 };
  const a = catenaDi(tab, 1_000_000);
  assert.equal(catenaDi(tab, 1_000_100), a, 'due navigazioni a un decimo di secondo sono la stessa catena');
  assert.equal(catenaDi(tab, 1_000_100 + PAUSA_MS), a, 'al limite della pausa la catena regge ancora');
  const b = catenaDi(tab, 1_000_100 + PAUSA_MS + PAUSA_MS + 1);
  assert.notEqual(b, a, 'dopo la pausa la catena è nuova');
  const altro = catenaDi({ id: 8 }, 1_000_000);
  assert.notEqual(altro, a, 'schede diverse, catene diverse');
});

test('una raffica di una catena sola non fa partire un controllo per indirizzo', async () => {
  const b = banco();
  for (let i = 0; i < 60; i++) SB.analyze(`http://${esca(i)}/login`, { hasPassword: true, catena: 'c1' });
  await attendi(150);
  assert.ok(
    b.llm.length <= SB.DEEP_MAX_PER_CATENA,
    `sessanta indirizzi della stessa catena hanno fatto partire ${b.llm.length} giudizi del modello`,
  );
  assert.ok(
    b.sandbox.length <= SB.DEEP_MAX_PER_CATENA,
    `e ${b.sandbox.length} finestre nascoste`,
  );
  assert.ok(
    b.gsb.length <= SB.LOOKUP_MAX_PER_CATENA,
    `e ${b.gsb.length} ricerche nell'elenco dei siti di truffa`,
  );
});

test('chi naviga dopo una pausa riceve il suo controllo anche se la catena di prima era esaurita', async () => {
  const b = banco();
  for (let i = 0; i < 60; i++) SB.analyze(`http://${esca(i)}/login`, { hasPassword: true, catena: 'c1' });
  await attendi(150);
  const dopoLaRaffica = b.llm.length;
  // La truffa vera, raggiunta dall'utente: catena nuova, conto intero.
  SB.analyze('http://paypa1-verifica-conto.com/login', { hasPassword: true, catena: 'c2' });
  await attendi(150);
  assert.ok(
    b.llm.length > dopoLaRaffica,
    'una catena esaurita non deve spegnere il controllo di chi arriva dopo',
  );
});

test('anche il riconoscimento del blocco geografico conta per catena', async () => {
  const cache = GEO.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate += 1; return 'errore_generico'; };
  for (let i = 0; i < 40; i++) {
    await GEO.classify(
      { title: 'Vietato', text: 'Access denied', statusCode: 403, host: `x${i}.pages.dev`, url: `http://x${i}.pages.dev/p${i}`, catena: 'c1' },
      { complete, cache },
    );
  }
  assert.ok(chiamate <= GEO.FRENO_PER_CATENA, `quaranta pagine ambigue hanno fatto ${chiamate} chiamate`);
  const dopo = chiamate;
  await GEO.classify(
    { title: 'Vietato', text: 'Access denied', statusCode: 403, host: 'sito-vero.com', url: 'http://sito-vero.com/p', catena: 'c2' },
    { complete, cache },
  );
  assert.ok(chiamate > dopo, 'il sito che l\'utente apre da sé apre una catena nuova');
});

test('le due schede dichiarano la catena: senza, il conto non ha a chi addebitare', async () => {
  const visti = [];
  const precedente = globalThis.SN_SAFEBROWSE;
  const precedenteGeo = globalThis.SN_GEO_CLASSIFY;
  globalThis.SN_SAFEBROWSE = {
    analyze: (_url, ctx) => { visti.push(ctx); return { level: 'safe', message: null, norm: null }; },
    normalize: () => null,
    proprietario: (h) => h,
  };
  globalThis.SN_GEO_CLASSIFY = (input) => { visti.push(input); return Promise.resolve({ skipped: true }); };
  try {
    class FintoTabManager {}
    installSafebrowse(FintoTabManager);
    installGeoBlock(FintoTabManager);
    const tab = { id: 3, title: 'x', view: { webContents: { send() {}, isDestroyed: () => false, getURL: () => 'http://sito-xyz.com/a' } } };
    const tm = new FintoTabManager();
    tm.incognito = false;
    tm.tabs = [tab];

    tm._sbOnNavigate(tab, 'http://sito-xyz.com/a');
    tm.safebrowseGet(3, 'http://sito-xyz.com/a', {});
    tm._geoLevel2Check(tab, 'http://sito-xyz.com/a', 'Access denied');
    await attendi(20);

    assert.equal(visti.length, 3);
    for (const v of visti) assert.ok(v && v.catena, 'ogni cammino deve dire di quale catena fa parte');
    assert.equal(visti[0].catena, visti[2].catena, 'la stessa navigazione è una catena sola');
  } finally {
    globalThis.SN_SAFEBROWSE = precedente;
    globalThis.SN_GEO_CLASSIFY = precedenteGeo;
  }
});
