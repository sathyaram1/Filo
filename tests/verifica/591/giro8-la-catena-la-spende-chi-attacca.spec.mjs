// Verifica #591 — giro 8. Il conto della catena di navigazioni lo spende chi
// attacca, e a restarne senza è la pagina dopo.
//
// Il giro 7 ha chiesto un TETTO e non una velocità, e il tetto è arrivato: il
// conto della catena, cioè di una pagina che si porta da sola su indirizzi
// sempre nuovi senza mai lasciar passare il tempo che serve a una persona per
// guardare. Il conto però è di CHI NAVIGA, non di chi ne beneficia: la pagina
// ostile lo svuota con le proprie navigazioni e poi porta l'utente sulla
// truffa vera DENTRO LA STESSA CATENA, dove non resta più niente. E la
// rinuncia della catena è definitiva: nessuno riprova.
//
// È la terza strada del terzo e del quarto giro (chi attacca spegne il
// controllo del sito di un altro) rientrata dalla porta aperta dal freno nuovo.
//
// Logica pura: le chiamate di rete e al modello sono finte.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const GEO = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// La catena è una sola: la pagina ostile naviga e poi consegna l'utente alla
// truffa senza mai fermarsi (src/main/tabs/catenaNavigazione.js).
const CATENA = 'catena-della-pagina-ostile';

function bancoSafebrowse() {
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

test('la truffa a cui la pagina ostile porta non riceve né giudizio né finestra nascosta', async () => {
  const b = bancoSafebrowse();
  // La pagina ostile si porta da sola su indirizzi suoi, che il controllo
  // locale trova sospetti: ogni passo spende due gettoni della catena.
  for (let i = 0; i < 4; i += 1) {
    SB.analyze(`http://paypa1-accesso-${i}.pages.dev/login`, { hasPassword: true, catena: CATENA });
    await attendi(120);
  }
  const llmPrima = b.llm.length;
  const sandboxPrima = b.sandbox.length;
  // Adesso l'utente viene portato sulla truffa vera, nella stessa catena.
  const verdetto = SB.analyze('http://paypa1-verifica-conto.com/login', { hasPassword: true, catena: CATENA });
  await attendi(300);
  expect(
    b.llm.length - llmPrima,
    'la truffa a cui la pagina ostile porta deve ricevere il giudizio del modello',
  ).toBe(1);
  expect(
    b.sandbox.length - sandboxPrima,
    'e deve ricevere anche la finestra nascosta',
  ).toBe(1);
  expect(
    !!verdetto.rimandato,
    'se la verifica si rinuncia, qualcuno deve riprovarla: altrimenti la pagina resta senza controllo',
  ).toBe(true);
});

test('caso di riscontro: fuori dalla catena della pagina ostile il controllo parte', async () => {
  const b = bancoSafebrowse();
  for (let i = 0; i < 4; i += 1) {
    SB.analyze(`http://paypa1-accesso-${i}.pages.dev/login`, { hasPassword: true, catena: CATENA });
    await attendi(120);
  }
  const llmPrima = b.llm.length;
  SB.analyze('http://paypa1-verifica-conto.com/login', { hasPassword: true, catena: 'catena-dell-utente' });
  await attendi(300);
  expect(
    b.llm.length - llmPrima,
    'chi arriva da una catena sua riceve il controllo: è la prova che a spegnerlo è la catena bruciata',
  ).toBe(1);
});

test('la pagina ostile spegne anche l\'elenco dei siti di truffa, e senza mostrare un solo avviso', async () => {
  const b = bancoSafebrowse();
  // Indirizzi qualunque, che il controllo locale non trova sospetti: l'utente
  // non vede nessun avviso mentre la catena si svuota.
  for (let i = 0; i < 30; i += 1) {
    SB.analyze(`http://pagina-${i}-esempio.com/x`, { catena: CATENA });
    await attendi(60);
  }
  await attendi(300);
  const gsbPrima = b.gsb.length;
  SB.analyze('http://banca-sicura-login.com/accesso', { hasPassword: true, catena: CATENA });
  await attendi(300);
  expect(
    b.gsb.length - gsbPrima,
    'l\'elenco dei siti di truffa è il segnale più affidabile: la pagina dopo deve poterlo consultare',
  ).toBe(1);
});

test('la stessa catena spegne il riconoscimento del blocco geografico del sito dopo', async () => {
  const cache = GEO.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate += 1; return 'geo_block'; };
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await GEO.classify({
      title: 'Forbidden', text: 'Access denied', statusCode: 403,
      host: `bloccato-${i}.com`, url: `http://bloccato-${i}.com/p`, catena: CATENA,
    }, { complete, cache });
  }
  const prima = chiamate;
  const res = await GEO.classify({
    title: 'Not available in your country', text: 'Access denied', statusCode: 403,
    host: 'sito-legittimo.tv', url: 'http://sito-legittimo.tv/video', catena: CATENA,
  }, { complete, cache });
  expect(
    chiamate - prima,
    'il sito bloccato nel paese dell\'utente deve essere riconosciuto anche dopo una raffica altrui',
  ).toBe(1);
  expect(
    res.route.proxy,
    'e la proposta di riaprirlo da un altro paese deve arrivare',
  ).toBe(true);
});
