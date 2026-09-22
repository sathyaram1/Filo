// Unit test — il conto della catena di navigazioni RIMANDA, non rinuncia
// (#591, ottavo giro di verifica).
//
// Il conto della catena ferma la pagina che si porta da sola su indirizzi
// sempre nuovi. A spenderlo però è chi NAVIGA, e chi naviga può essere la
// pagina ostile: svuotava il conto con le proprie navigazioni e poi portava
// l'utente sulla truffa dentro la stessa catena, dove non restava niente e
// nessuno riprovava. Con tre salti spariva il giudizio del modello e la
// finestra nascosta; con ventiquattro indirizzi qualunque, senza far comparire
// un solo avviso, spariva anche la ricerca nell'elenco dei siti di truffa.
//
// La regola difesa qui: una verifica che il conto della catena non lascia
// partire si DICHIARA rimandata, e la pagina dove la scheda è rimasta la
// riottiene insistendo (`insistito`), che è la prova che non è una raffica.
// Senza la correzione questi casi sono rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = require_(join(ROOT, 'src/main/services/safebrowse/index.js'));
const GEO = require_(join(ROOT, 'src/main/services/geoBlockClassifier.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const CATENA = 'catena-della-pagina-ostile';
const DA_EMAIL = { linkOrigin: 'email', hasPassword: true };

function banco() {
  const b = { gsb: [], llm: [], sandbox: [] };
  for (const c of Object.values(SB._caches)) c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();
  SB.setProviders({
    gsb: async (u) => { b.gsb.push(u); return { listed: false }; },
    rdap: async () => 400,
    ct: async () => null,
    llm: async () => { b.llm.push(1); return null; },
    sandbox: async () => { b.sandbox.push(1); return null; },
  });
  return b;
}

test('la truffa dove l\'utente resta riceve il controllo anche a catena svuotata', async () => {
  const b = banco();
  for (let i = 0; i < 4; i++) {
    SB.analyze(`http://paypa1-accesso-${i}.pages.dev/login`, { ...DA_EMAIL, catena: CATENA });
    await attendi(5);
  }
  const giudiziPrima = b.llm.length;
  const finestrePrima = b.sandbox.length;
  const TRUFFA = 'http://paypa1-verifica-conto.com/login';
  const verdetto = SB.analyze(TRUFFA, { ...DA_EMAIL, catena: CATENA });
  await attendi(20);
  assert.equal(!!verdetto.rimandato, true, 'la verifica non parte: va dichiarata rimandata, non persa');
  SB.analyze(TRUFFA, { ...DA_EMAIL, catena: CATENA, insistito: true });
  await attendi(20);
  assert.equal(b.llm.length - giudiziPrima, 1, 'insistendo, il giudizio del modello parte');
  assert.equal(b.sandbox.length - finestrePrima, 1, 'e parte anche la finestra nascosta');
});

test('la ricerca nell\'elenco dei siti di truffa non si perde con la catena svuotata', async () => {
  const b = banco();
  const conto = SB._caches.catenaLookup;
  // Svuota il conto della catena senza toccare quello comune, che è una
  // raffica di pochi secondi e qui non c'entra.
  for (let i = 0; i < SB.LOOKUP_MAX_PER_CATENA; i++) conto.prendi('l:' + CATENA, SB.LOOKUP_MAX_PER_CATENA);
  const TRUFFA = 'http://banca-sicura-login.com/accesso';
  const verdetto = SB.analyze(TRUFFA, { ...DA_EMAIL, catena: CATENA });
  await attendi(20);
  assert.equal(!!verdetto.rimandato, true, 'anche il primo stadio dichiara la rinuncia');
  assert.equal(b.gsb.length, 0);
  SB.analyze(TRUFFA, { ...DA_EMAIL, catena: CATENA, insistito: true });
  await attendi(20);
  assert.equal(b.gsb.length, 1, 'insistendo, l\'indirizzo viene cercato nell\'elenco');
});

test('il blocco geografico del sito dopo non si perde con la catena svuotata', async () => {
  const cache = GEO.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate += 1; return 'geo_block'; };
  for (let i = 0; i < GEO.FRENO_PER_CATENA + 2; i++) {
    // eslint-disable-next-line no-await-in-loop
    await GEO.classify({
      title: 'Forbidden', text: 'Access denied', statusCode: 403,
      host: `bloccato-${i}.com`, url: `http://bloccato-${i}.com/p`, catena: CATENA,
    }, { complete, cache });
  }
  const prima = chiamate;
  const pagina = {
    title: 'Not available in your country', text: 'Access denied', statusCode: 403,
    host: 'sito-legittimo.tv', url: 'http://sito-legittimo.tv/video', catena: CATENA,
  };
  const res = await GEO.classify(pagina, { complete, cache });
  assert.equal(!!res.rimandato, true, 'la rinuncia della catena si dichiara');
  const res2 = await GEO.classify({ ...pagina, insistito: true }, { complete, cache });
  assert.equal(chiamate - prima, 1, 'insistendo, il riconoscimento parte');
  assert.equal(res2.route.proxy, true, 'e la proposta di riaprirlo da un altro paese arriva');
});

test('insistere non è un lasciapassare: restano il conto di chi possiede il sito e quello comune', async () => {
  const b = banco();
  let giudizi = 0;
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { giudizi++; return null; },
    sandbox: async () => null,
  });
  for (let i = 0; i < 12; i++) {
    SB.analyze(`http://paypa1-accedi-${i}.esempio-insistenza-591.tk/login`, { ...DA_EMAIL, insistito: true });
    await attendi(3);
  }
  assert.equal(giudizi, SB.DEEP_MAX_PER_OWNER, 'chi possiede il sito ha il suo tetto anche per chi insiste');
  assert.equal(b.llm.length, 0);
});
