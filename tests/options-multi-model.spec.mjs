// Feedback: "per ogni attività deve essere possibile impostare più modelli (il
// primo è quello usato, gli altri sono fallback in ordine)" + "ogni modello ha
// un tasto prova che salva latenza e token al secondo".
//
// Questi test asseriscono il COMPORTAMENTO della feature:
//   1. La catena di fallback per un'azione con più nickname è costruita
//      nell'ordine giusto (tutti i provider del modello primario, poi quelli
//      del secondo, ecc.). Senza il fix `buildModelAttempts` non esisteva e la
//      risoluzione gestiva un solo modello.
//   2. Un risultato di test (latenza + token/sec) salvato su un modello del
//      registry persiste tra i reload della pagina opzioni. Senza il fix il
//      risultato era effimero (solo durante il test) e spariva al reload.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('Modelli: la catena di fallback per azione ordina primario poi secondari', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const chain = await page.evaluate(() => {
    const C = window.SN_CONST;
    const refs = C.parseModelRefs('flash, flash-or, claude-haiku');
    const order = ['gemini', 'openrouter'];
    const keys = { gemini: 'gm', openrouter: 'or' };
    return C.buildModelAttempts(refs, C.DEFAULT_MODEL_REGISTRY, order, keys);
  });

  // Nuovo schema: ogni nickname ha UN solo provider. Il fallback cross-provider
  // si ottiene elencando i gemelli ('flash' su Gemini, 'flash-or' su OpenRouter)
  // → catena attesa: gemini(flash) → openrouter(flash-or) → openrouter(claude-haiku).
  expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
    'gemini:gemini-2.0-flash',
    'openrouter:google/gemini-2.0-flash-001',
    'openrouter:anthropic/claude-3.5-haiku',
  ]);
});

test('Modelli: un singolo nickname risolve solo sul suo provider', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const chain = await page.evaluate(() => {
    const C = window.SN_CONST;
    const refs = C.parseModelRefs('flash');
    return C.buildModelAttempts(refs, C.DEFAULT_MODEL_REGISTRY, ['openrouter'], { openrouter: 'or' });
  });
  // 'flash' è un modello Gemini: non deve comparire alcun tentativo OpenRouter.
  expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
    'gemini:gemini-2.0-flash',
  ]);
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
    // Scopa a #modelRegistryList: `.sn-model-row` è usata anche dalla lista
    // read-only dei modelli predefiniti (#defaultModelsList), che apparendo
    // prima nel DOM verrebbe presa per errore (e non ha .sn-model-nick).
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'provatm';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'anthropic/claude-3.5-haiku';
    row._test = { ttftMs: 321, tokensPerSec: 48.5, at: new Date().toISOString() };
    // Forza il render immediato + il salvataggio (change bubbla fino a #page).
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricarica: il risultato salvato deve riapparire nel div di stato della riga.
  await page.reload();
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  const statusText = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
    const row = rows.find((r) => r.querySelector('.sn-model-nick')?.value === 'provatm');
    return row ? row.querySelector('.sn-model-row-status')?.textContent || '' : '';
  });
  expect(statusText).toContain('321');
  expect(statusText).toContain('48.5');
});
