// Unit test — «Filo è pronto?» si decide su quello che la chiamata userà.
//
// Regola (#663): la prontezza guarda i modelli configurati per la funzione e la
// chiave del fornitore che OGNI voce dichiara, mai il campo `provider` dei
// settings. Quel campo è una dichiarazione a parte: quando nominava un
// fornitore ritirato, accoglienza e prima home si spegnevano mentre ogni
// chiamata funzionava.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'tests', 'fixtures', 'testModels.js'));
const C = globalThis.SN_CONST;

const REGISTRY = {
  testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' },
};

// La configurazione dell'incidente: il fornitore dichiarato non esiste più e
// nessuna chiave porta quel nome, ma i modelli sono serviti da OpenRouter e la
// chiave di OpenRouter c'è.
const CONFIG_ROTTA = {
  provider: 'gemini',
  models: {
    [C.ACTIONS.FILO_CHAT]: 'testo',
    [C.ACTIONS.FILO_DASHBOARD]: 'testo',
  },
  modelRegistry: REGISTRY,
  apiKeys: { openrouter: 'sk-or-vera', tavily: 'tvly-x' },
};

test('un fornitore dichiarato senza chiave non spegne Filo se i modelli ne hanno una', () => {
  assert.equal(CONFIG_ROTTA.apiKeys[CONFIG_ROTTA.provider], undefined);
  assert.equal(C.canServeAction(CONFIG_ROTTA, C.ACTIONS.FILO_CHAT), true);
  assert.equal(C.canServeAction(CONFIG_ROTTA, C.ACTIONS.FILO_DASHBOARD), true);
});

test('senza nessuna chiave Filo non è pronto, qualunque cosa dica il fornitore', () => {
  const senzaChiave = { ...CONFIG_ROTTA, provider: 'openrouter', apiKeys: { tavily: 'tvly-x' } };
  assert.equal(C.canServeAction(senzaChiave, C.ACTIONS.FILO_CHAT), false);
  assert.deepEqual(C.modelProvidersWithKey(senzaChiave.apiKeys), []);
});

test('chiave buona ma funzione senza modello: non è pronto (e non è colpa dei crediti)', () => {
  const senzaModello = { ...CONFIG_ROTTA, models: { [C.ACTIONS.FILO_CHAT]: '' } };
  assert.equal(C.canServeAction(senzaModello, C.ACTIONS.FILO_CHAT), false);
  assert.deepEqual(C.modelProvidersWithKey(senzaModello.apiKeys), ['openrouter']);
});

test('una scorciatoia che il registry non conosce non rende pronta la funzione', () => {
  const fantasma = { ...CONFIG_ROTTA, models: { [C.ACTIONS.FILO_CHAT]: 'scomparso' } };
  assert.equal(C.canServeAction(fantasma, C.ACTIONS.FILO_CHAT), false);
});

test('la prontezza è per funzione: una scoperta non spegne le altre', () => {
  const mista = {
    ...CONFIG_ROTTA,
    models: { [C.ACTIONS.FILO_CHAT]: 'testo', [C.ACTIONS.FILO_DASHBOARD]: '' },
  };
  assert.equal(C.canServeAction(mista, C.ACTIONS.FILO_CHAT), true);
  assert.equal(C.canServeAction(mista, C.ACTIONS.FILO_DASHBOARD), false);
});

test('«solo pesi aperti» conta: se non resta niente da sostituire non è pronto', () => {
  const proprietario = {
    provider: 'openrouter',
    models: { [C.ACTIONS.FILO_CHAT]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
    apiKeys: { openrouter: 'sk-or-vera' },
  };
  assert.equal(C.canServeAction(proprietario, C.ACTIONS.FILO_CHAT), true);
  assert.equal(C.canServeAction({ ...proprietario, openWeightsOnly: true }, C.ACTIONS.FILO_CHAT), false);
});

test('la prontezza usa lo stesso ordine dei fornitori delle chiamate vere', () => {
  const attempts = C.buildModelAttempts(['testo'], REGISTRY, C.PROVIDER_ORDER, CONFIG_ROTTA.apiKeys);
  assert.equal(attempts.length > 0, C.canServeAction(CONFIG_ROTTA, C.ACTIONS.FILO_CHAT));
  assert.equal(attempts[0].provider, 'openrouter');
});

// Chi tace deve dire il motivo giusto: mandare a rivedere i modelli chi ne ha
// di buoni, e li esclude l'interruttore, lascia senza spiegazione.
test('il motivo del silenzio distingue la chiave, l’interruttore e i modelli', () => {
  const AZIONI = [C.ACTIONS.FILO_DASHBOARD, C.ACTIONS.FILO_CHAT];
  assert.equal(C.whyCannotServe(CONFIG_ROTTA, AZIONI), '');
  assert.equal(C.whyCannotServe({ ...CONFIG_ROTTA, apiKeys: { tavily: 'tvly-x' } }, AZIONI), 'chiave');
  assert.equal(C.whyCannotServe({ ...CONFIG_ROTTA, models: {} }, AZIONI), 'modelli');
  assert.equal(
    C.whyCannotServe({ ...CONFIG_ROTTA, models: { [C.ACTIONS.FILO_CHAT]: 'scomparso' } }, AZIONI),
    'modelli',
  );

  const soloProprietari = {
    provider: 'openrouter',
    models: { [C.ACTIONS.FILO_CHAT]: 'chiuso', [C.ACTIONS.FILO_DASHBOARD]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
    apiKeys: { openrouter: 'sk-or-vera' },
  };
  assert.equal(C.whyCannotServe(soloProprietari, AZIONI), '');
  assert.equal(C.whyCannotServe({ ...soloProprietari, openWeightsOnly: true }, AZIONI), 'pesi-aperti');
  // Senza chiave l'interruttore non c'entra: il primo ostacolo è la chiave.
  assert.equal(
    C.whyCannotServe({ ...soloProprietari, openWeightsOnly: true, apiKeys: {} }, AZIONI),
    'chiave',
  );
  // Basta una funzione servita perché non ci sia niente da spiegare.
  assert.equal(
    C.whyCannotServe({ ...CONFIG_ROTTA, models: { [C.ACTIONS.FILO_CHAT]: 'testo' } }, AZIONI),
    '',
  );
});

// Sentinella: il controllo di prontezza non deve tornare a guardare il campo
// `provider`. Se ricompare `apiKeys[...provider]` in un cammino che decide se
// Filo può rispondere, l'incidente rientra dalla stessa porta.
test('nessun controllo di prontezza legge apiKeys[settings.provider]', async () => {
  const { readFileSync } = await import('node:fs');
  const files = [
    join(ROOT, 'src', 'main', 'services', 'handlers.js'),
    join(ROOT, 'src', 'main', 'services', 'handlers', 'filo.js'),
    join(ROOT, 'src', 'main', 'services', 'handlers', 'ai.js'),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.equal(
      /apiKeys\s*\??\.?\s*\[\s*(settings|s|cfg)\.provider\s*\]/.test(src),
      false,
      `${f}: la prontezza va decisa con SN_CONST.canServeAction, non dal fornitore dichiarato`,
    );
  }
});

// Il portafoglio è la terza sorgente della prontezza, e per chi entra con un
// invito è l'unica: la sua chiave non passa dalle impostazioni. Se depositarla
// o toglierla non avvisa nessuno, il conto di «Filo può rispondere» resta fermo
// su com'era prima del riscatto, e l'avviso alle home aperte — che parte solo
// quando quel conto cambia — non parte più in nessuna direzione (#663).
test('il portafoglio avvisa chi tiene il conto della prontezza', () => {
  const wallet = require(join(ROOT, 'src', 'main', 'auth', 'wallet-store.js'));
  const prima = globalThis.SN_PRONTEZZA_CAMBIATA;
  let avvisi = 0;
  globalThis.SN_PRONTEZZA_CAMBIATA = () => { avvisi += 1; };
  try {
    wallet.save({ key: 'sk-or-personale', pseudonym: 'prova' });
    assert.equal(avvisi, 1, 'la chiave depositata deve avvisare');
    assert.equal(wallet.personalKey(), 'sk-or-personale');
    wallet.clear();
    assert.equal(avvisi, 2, 'la chiave tolta deve avvisare');
    assert.equal(wallet.personalKey(), '');
  } finally {
    globalThis.SN_PRONTEZZA_CAMBIATA = prima;
    wallet.clear();
  }
});
