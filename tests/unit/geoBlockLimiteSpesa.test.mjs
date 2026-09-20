// Il classificatore del blocco geografico passa dal cancello unico (#591).
//
// Era il caso peggiore dei quattro: parte da solo a ogni caricamento di pagina
// ambiguo e si azzera a ogni navigazione, quindi era anche il più facile da far
// ripartire all'infinito. Chiamava il fornitore direttamente, senza limite di
// spesa e senza comparire nel conteggio dei costi.
//
// Qui si prova la classe del difetto sul chiamante più esposto: col mese
// esaurito il modello non viene toccato, e quando invece parte il costo finisce
// nel conto sotto il nome giusto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const require_ = createRequire(import.meta.url);

require_(join(REPO, 'src/shared/constants.js'));
const { ACTIONS } = globalThis.SN_CONST;
const Gate = require_(join(REPO, 'src/main/services/modelGate.js'));
const Classifier = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

const SETTINGS = { monthlyLimitEur: 5, usdToEur: 0.92, pricing: {}, excludedProviders: [] };

// Il caso ambiguo che fa scattare il classificatore: 403 con una pagina che non
// dice niente di conclusivo.
const CASO = {
  statusCode: 403,
  host: 'video.esempio.com',
  url: 'https://video.esempio.com/guarda/1',
  title: 'Accesso negato',
  text: 'Questo contenuto non è disponibile.',
};

function banco({ oltreIlLimite = false } = {}) {
  const chiamate = [];
  const registrate = [];
  globalThis.SN_PROVIDERS = {
    completeWithFallback: async (args) => {
      chiamate.push(args);
      return { text: 'blocco_geografico', usage: { promptTokens: 200, completionTokens: 5 } };
    },
  };
  globalThis.SN_COSTS = {
    isOverLimit: async () => oltreIlLimite,
    record: async (r) => { registrate.push(r); return 0.0004; },
  };
  Gate.configure({
    modelForAction: () => 'economico',
    buildAttemptChain: () => [{ provider: 'finto', apiKey: 'k', model: 'modello-economico' }],
    providerRouting: () => null,
    noteServedProvider: () => ({ servedBy: null, violation: false }),
  });
  return { chiamate, registrate };
}

// La stessa forma con cui handlers.js collega il classificatore al cancello.
const completeDalCancello = async ({ messages, signal }) => {
  const r = await Gate.complete({
    settings: SETTINGS, action: ACTIONS.GEOBLOCK_CLASSIFY, messages, signal,
  });
  return r.text;
};

test('col limite di spesa esaurito il classificatore non chiama il modello', async () => {
  const b = banco({ oltreIlLimite: true });
  const out = await Classifier.classify(CASO, {
    complete: completeDalCancello,
    cache: Classifier.createCache(),
  });
  assert.deepEqual(b.chiamate, [], 'nessuna chiamata al fornitore oltre il limite');
  assert.deepEqual(b.registrate, [], 'niente costo per una chiamata mai partita');
  // Per l'utente: nessuna azione, la pagina resta com'è.
  assert.equal(out.class, Classifier.CLASSES.ERRORE_GENERICO);
  assert.equal(out.route.proxy, false);
});

test('sotto il limite il classificatore parte e il suo costo finisce nel conto', async () => {
  const b = banco();
  const out = await Classifier.classify(CASO, {
    complete: completeDalCancello,
    cache: Classifier.createCache(),
  });
  assert.equal(b.chiamate.length, 1, 'il modello va chiamato');
  assert.equal(out.class, Classifier.CLASSES.BLOCCO_GEOGRAFICO);
  assert.equal(b.registrate.length, 1, 'la chiamata deve comparire nel conteggio dei costi');
  assert.equal(b.registrate[0].action, ACTIONS.GEOBLOCK_CLASSIFY,
    'sotto il nome della funzione che l\'ha fatta partire, non di un\'altra');
  assert.equal(b.registrate[0].model, 'modello-economico');
});

test('il giudizio anti-phishing passa dallo stesso cancello', async () => {
  const b = banco({ oltreIlLimite: true });
  await assert.rejects(
    () => Gate.complete({
      settings: SETTINGS, action: ACTIONS.SAFEBROWSE_JUDGE,
      messages: [{ role: 'user', content: 'metadati' }],
    }),
    (e) => e.code === 'LIMIT_REACHED',
  );
  assert.deepEqual(b.chiamate, []);
});
