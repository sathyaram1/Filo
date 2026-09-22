// Verifica #591 — giro 7. I freni sono una VELOCITÀ, non un totale.
//
// La segnalazione parte da qui: con le chiavi condivise di fabbrica paga
// l'owner, e «qualunque indirizzo http fuori dai fidati fa partire un giudizio
// del modello più l'apertura della pagina in una finestra nascosta». I giri
// passati hanno messo un conto per chi possiede il sito e, accanto, un conto
// comune corto. Il conto comune si riapre da solo ogni pochi secondi: una
// pagina ostile che si porta da sola su sotto-indirizzi sempre nuovi (su una
// piattaforma che ne regala uno a testa, ogni sotto-indirizzo è un
// proprietario diverso) non viene fermata, viene solo rallentata — e può
// tenere quella velocità per sempre.
//
// Le prove non fissano un numero «giusto»: guardano se il conto SMETTE di
// crescere. Un freno che è un tetto dà lo stesso numero dopo quattro secondi e
// dopo sedici; un freno che è una velocità no.
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
const PRESTO_MS = 4000;
const TARDI_MS = 16000;

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

// Una pagina ostile che si porta da sola su indirizzi sempre nuovi. `host(i)`
// decide se sono di proprietari diversi (sotto-indirizzi gratuiti) o dello
// stesso sito.
async function raffica(host, passo) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < TARDI_MS) {
    await passo(host(i), i);
    i += 1;
    await attendi(15);
  }
  await attendi(300);
  return { navigazioni: i };
}

test('il giudizio del modello e le finestre nascoste ripartono a ogni raffica', async () => {
  const b = bancoSafebrowse();
  let presto = 0;
  const t0 = Date.now();
  await raffica(
    (i) => `paypa1-accesso-${i}.pages.dev`,
    async (h) => {
      SB.analyze(`http://${h}/login`, { hasPassword: true });
      if (!presto && Date.now() - t0 >= PRESTO_MS) presto = b.llm.length;
    },
  );
  expect(presto, 'la raffica deve aver fatto partire qualcosa nei primi secondi').toBeGreaterThan(0);
  expect(
    b.llm.length,
    'il conto delle chiamate al modello deve essere un tetto, non una velocità: dopo sedici '
    + 'secondi non deve essere cresciuto rispetto ai primi quattro',
  ).toBeLessThanOrEqual(presto + 2);
  expect(
    b.sandbox.length,
    'lo stesso vale per le finestre nascoste con JavaScript attivo',
  ).toBeLessThanOrEqual(presto + 2);
}, { timeout: 60_000 });

test('anche la ricerca nell\'elenco dei siti di truffa riparte a ogni raffica', async () => {
  const b = bancoSafebrowse();
  let presto = 0;
  const t0 = Date.now();
  await raffica(
    (i) => `vetrina-${i}.pages.dev`,
    async (h, i) => {
      SB.analyze(`http://${h}/p${i}`, {});
      if (!presto && Date.now() - t0 >= PRESTO_MS) presto = b.gsb.length;
    },
  );
  expect(presto, 'la raffica deve aver fatto partire qualcosa nei primi secondi').toBeGreaterThan(0);
  expect(
    b.gsb.length,
    'la chiave di fabbrica dell\'owner ha una quota giornaliera: il conto deve essere un tetto, '
    + 'non una velocità che si può tenere per sempre',
  ).toBeLessThanOrEqual(presto + 2);
}, { timeout: 60_000 });

test('il riconoscimento del blocco geografico riparte a ogni raffica', async () => {
  const cache = GEO.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate += 1; return 'errore_generico'; };
  let presto = 0;
  const t0 = Date.now();
  await raffica(
    (i) => `bloccato-${i}.pages.dev`,
    async (h, i) => {
      await GEO.classify(
        { title: 'Forbidden', text: 'Access denied', statusCode: 403, host: h, url: `http://${h}/p${i}` },
        { complete, cache },
      );
      if (!presto && Date.now() - t0 >= PRESTO_MS) presto = chiamate;
    },
  );
  expect(presto, 'la raffica deve aver fatto partire qualcosa nei primi secondi').toBeGreaterThan(0);
  expect(
    chiamate,
    'anche qui il conto comune deve essere un tetto, non una velocità',
  ).toBeLessThanOrEqual(presto + 2);
}, { timeout: 60_000 });

test('caso di riscontro: su un dominio normale il conto è davvero un tetto', async () => {
  const b = bancoSafebrowse();
  let presto = 0;
  const t0 = Date.now();
  await raffica(
    (i) => `paypa1-accesso-${i}.un-solo-attaccante-xyz.com`,
    async (h) => {
      SB.analyze(`http://${h}/login`, { hasPassword: true });
      if (!presto && Date.now() - t0 >= PRESTO_MS) presto = b.llm.length;
    },
  );
  expect(
    b.llm.length,
    'chi ha un dominio solo è già fermato: è la prova che il conto per proprietario funziona',
  ).toBeLessThanOrEqual(presto + 2);
}, { timeout: 60_000 });
