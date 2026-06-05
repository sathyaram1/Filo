// Feedback (riaperto): "voglio poter impostare i modelli fallback con spazi
// extra (GUI), e voglio UN provider per ogni modello".
//
// Questi test asseriscono il COMPORTAMENTO della feature col nuovo schema:
//   1. Ogni modello del registry ha UN solo provider: la catena di fallback per
//      un'azione con più nickname prova prima il modello primario (sul suo
//      provider), poi il secondo, ecc. — nell'ordine indicato dall'utente.
//   2. Le vecchie config "duali" ({ openrouter, gemini } per un nickname)
//      continuano a funzionare a runtime (retro-compatibilità).
//   3. I modelli per azione si impostano con una GUI a slot (primario + fallback
//      aggiungibili): salvati e ricaricati, gli slot e l'ordine si preservano.
//   4. Il risultato del tasto Prova (latenza + token/sec) di un modello del
//      registry persiste tra i reload.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('Modelli: la catena di fallback per azione ordina primario poi secondari', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const chain = await page.evaluate(() => {
    const C = window.SN_CONST;
    const refs = C.parseModelRefs('flash, claude-haiku');
    const order = ['gemini', 'openrouter'];
    const keys = { gemini: 'gm', openrouter: 'or' };
    return C.buildModelAttempts(refs, C.DEFAULT_MODEL_REGISTRY, order, keys);
  });

  // flash è un modello Gemini, claude-haiku è un modello OpenRouter → catena
  // attesa: gemini(flash) → openrouter(claude-haiku). Ogni modello prova SOLO
  // il suo provider (uno per modello).
  expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
    'gemini:gemini-2.0-flash',
    'openrouter:anthropic/claude-3.5-haiku',
  ]);
});

test('Modelli: fallback cross-provider esplicito con due modelli gemelli', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const chain = await page.evaluate(() => {
    const C = window.SN_CONST;
    const refs = C.parseModelRefs('flash, flash-or');
    return C.buildModelAttempts(refs, C.DEFAULT_MODEL_REGISTRY, ['gemini', 'openrouter'], { gemini: 'gm', openrouter: 'or' });
  });
  // Primario = flash (Gemini), fallback = flash-or (lo stesso modello su
  // OpenRouter). Così il fallback su un altro provider è esplicito.
  expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
    'gemini:gemini-2.0-flash',
    'openrouter:google/gemini-2.0-flash-001',
  ]);
});

test('Modelli: un singolo nickname prova solo il suo provider', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const chain = await page.evaluate(() => {
    const C = window.SN_CONST;
    const refs = C.parseModelRefs('flash');
    return C.buildModelAttempts(refs, C.DEFAULT_MODEL_REGISTRY, ['gemini', 'openrouter'], { gemini: 'gm', openrouter: 'or' });
  });
  expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
    'gemini:gemini-2.0-flash',
  ]);
});

test('Modelli: le vecchie entry duali restano retro-compatibili', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const chain = await page.evaluate(() => {
    const C = window.SN_CONST;
    // Entry legacy: un nickname con id per due provider (schema pre-refactor).
    const legacyRegistry = { dual: { label: 'Dual', openrouter: 'a/b', gemini: 'c-d' } };
    const refs = C.parseModelRefs('dual');
    return C.buildModelAttempts(refs, legacyRegistry, ['gemini', 'openrouter'], { gemini: 'gm', openrouter: 'or' });
  });
  // Senza provider esplicito si prova l'intero providerOrder (come prima).
  expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
    'gemini:c-d',
    'openrouter:a/b',
  ]);
});

test('Modelli per azione: GUI a slot primario + fallback persiste la catena', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  // Rivela la config avanzata (registry + modelli per azione).
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-models:not([hidden])', { timeout: 4_000 });

  const action = await page.evaluate(() => window.SN_CONST.ACTIONS.EXPLAIN);

  // L'azione "explain" di default ha 2 slot: flash (primario) + flash-or (fallback).
  const initial = await page.evaluate((a) => {
    const cell = document.querySelector(`#modelsGrid [data-action="${a}"]`);
    return [...cell.querySelectorAll('.sn-slot-input')].map((i) => i.value);
  }, action);
  expect(initial).toEqual(['flash', 'flash-or']);

  // Aggiungi un terzo slot di fallback, scrivici un nickname, salva.
  await page.evaluate((a) => {
    const cell = document.querySelector(`#modelsGrid [data-action="${a}"]`);
    cell.querySelector('.sn-add-fallback').click();
    const inputs = cell.querySelectorAll('.sn-slot-input');
    const last = inputs[inputs.length - 1];
    last.value = 'claude-haiku';
    last.dispatchEvent(new Event('change', { bubbles: true }));
  }, action);
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Il valore salvato è la lista in ordine, separata da virgola.
  const stored = await page.evaluate(async (a) => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[a];
  }, action);
  expect(stored).toBe('flash, flash-or, claude-haiku');

  // Ricarica: i tre slot devono riapparire nell'ordine giusto.
  await page.reload();
  await page.waitForSelector('#sec-models:not([hidden])', { timeout: 8_000 });
  const after = await page.evaluate((a) => {
    const cell = document.querySelector(`#modelsGrid [data-action="${a}"]`);
    return [...cell.querySelectorAll('.sn-slot-input')].map((i) => i.value);
  }, action);
  expect(after).toEqual(['flash', 'flash-or', 'claude-haiku']);
});

test('Modelli: il risultato del test (latenza/token-sec) persiste tra i reload', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  // Rivela la config avanzata (registry + modelli per azione).
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  // Compila la prima riga del registry e simula un risultato di test salvato
  // (in cloud non c'è la API key per il vero "Prova", ma la persistenza non
  // dipende dalla rete: passa per lo stesso salvataggio del registry).
  await page.evaluate(() => {
    const row = document.querySelector('.sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'provatm';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'anthropic/claude-3.5-haiku';
    row._test = { provider: 'openrouter', ttftMs: 321, tokensPerSec: 48.5, at: new Date().toISOString() };
    // Forza il salvataggio (change bubbla fino a #page).
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricarica: il risultato salvato deve riapparire nel div di stato della riga.
  await page.reload();
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 8_000 });

  const statusText = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')];
    const row = rows.find((r) => r.querySelector('.sn-model-nick')?.value === 'provatm');
    return row ? row.querySelector('.sn-model-row-status')?.textContent || '' : '';
  });
  expect(statusText).toContain('321');
  expect(statusText).toContain('48.5');
  expect(statusText).toContain('OpenRouter');
});
