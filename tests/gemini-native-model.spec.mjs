// Feedback: "se imposto Gemini come provider e uso il codice del modello (come
// appare su Google AI Studio, es. gemini-3.1-flash-lite) non funziona".
//
// Causa vera: il registry salva i modelli Gemini col loro nome NATIVO
// (gemini-2.0-flash, gemini-3.1-flash-lite), ma `toGeminiModelId` accettava SOLO
// gli id stile OpenRouter "google/...". Risultato: OGNI tentativo sul provider
// Gemini lanciava "modello non Google" e ripiegava in silenzio su OpenRouter —
// la chiave Gemini non veniva mai usata davvero.
//
// Questi test asseriscono il SUCCESSO della feature (il provider Gemini accetta
// il nome nativo), non l'assenza di un certo errore. Pre-condizione che senza il
// fix fallirebbe: prima `toGeminiModelId('gemini-2.0-flash')` ritornava null.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('Gemini: il provider accetta i nomi nativi dei modelli (codici AI Studio)', async ({ app }) => {
  // Gira nel MAIN process, dove providers/gemini.js è caricato dal loader.
  const resolved = await app.evaluate(() => {
    const g = globalThis.SN_PROVIDER_GEMINI;
    return {
      flash20: g.toGeminiModelId('gemini-2.0-flash'),
      lite31: g.toGeminiModelId('gemini-3.1-flash-lite'),
      flash35: g.toGeminiModelId('gemini-3.5-flash'),
      gemma: g.toGeminiModelId('gemma-4-31b-it'),
      // Lo stile OpenRouter resta supportato (retro-compatibilità).
      orStyle: g.toGeminiModelId('google/gemini-2.0-flash-001'),
      // Un modello non-Google deve restare null → caller usa OpenRouter.
      nonGoogle: g.toGeminiModelId('anthropic/claude-3.5-haiku'),
    };
  });

  // Prima del fix queste erano TUTTE null (tranne orStyle/nonGoogle).
  expect(resolved.flash20).toBe('gemini-2.0-flash');
  expect(resolved.lite31).toBe('gemini-3.1-flash-lite');
  expect(resolved.flash35).toBe('gemini-3.5-flash');
  expect(resolved.gemma).toBe('gemma-4-31b-it');
  expect(resolved.orStyle).toBe('gemini-2.0-flash-001');
  expect(resolved.nonGoogle).toBeNull();
});

test('Gemini: gemini-3.1-flash-lite è selezionabile e finisce sul provider gemini', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

  const out = await page.evaluate(() => {
    const C = window.SN_CONST;
    const reg = C.DEFAULT_MODEL_REGISTRY;
    // Il nuovo nickname esiste nel registry...
    const entry = reg['flash-lite-3'];
    // ...e la catena di fallback lo mette PRIMA su Gemini, poi su OpenRouter.
    const refs = C.parseModelRefs('flash-lite-3, flash-lite-3-or');
    const chain = C.buildModelAttempts(refs, reg, ['gemini', 'openrouter'], { gemini: 'gm', openrouter: 'or' });
    return { entry, chain: chain.map((a) => `${a.provider}:${a.model}`) };
  });

  expect(out.entry).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
  expect(out.chain).toEqual([
    'gemini:gemini-3.1-flash-lite',
    'openrouter:google/gemini-3.1-flash-lite-preview',
  ]);
});

test('Gemini: gemini-3.1-flash-lite NON viene più declassato a 2.0', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForFunction(() => !!window.SN_CONST?.parseModelRefs, null, { timeout: 8_000 });

  const refs = await page.evaluate(() =>
    window.SN_CONST.parseModelRefs('google/gemini-3.1-flash-lite-preview'));

  // Prima del fix il deprecated-map lo riscriveva in google/gemini-2.0-flash-lite-001.
  expect(refs).toEqual(['google/gemini-3.1-flash-lite-preview']);
});
