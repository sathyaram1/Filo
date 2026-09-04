// #273 — "Fallback provider AI in streaming lascia testo del tentativo fallito
// in chat": quando il provider primario cade a metà risposta (dopo aver già
// streamato dei delta) e il router ripiega sul secondo provider, il popup di
// spiegazione/traduzione accumulava i delta di ENTRAMBI i tentativi → messaggio
// finale incollato/rotto (pezzo del primo + risposta completa del secondo).
//
// Fix: il router emette un segnale di reset prima di ripartire e i consumer
// azzerano il buffer. Qui giriamo il router VERO con provider finti (il primo
// emette testo poi lancia, il secondo risponde pulito) e asseriamo il SUCCESSO:
// il messaggio finale nel popup è ESATTAMENTE la risposta pulita del fallback,
// senza residui del tentativo fallito. Senza il fix l'assert "niente residuo"
// diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

test('fallback a metà streaming: il popup mostra solo la risposta pulita del secondo provider', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    // Due nickname → catena reale di 2 attempt (gemini poi openrouter).
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'flash-lite-3,flash-lite-or' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    // Provider finti: NON stubbiamo il router (streamCompleteWithFallback), che
    // resta quello vero — è proprio la sua logica di reset sotto test.
    globalThis.__origGem = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__origOr = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origGem,
      streamComplete: async ({ onDelta }) => {
        onDelta('TESTO-SPORCO del primo tentativo che si interr');
        await new Promise((r) => setTimeout(r, 60));
        onDelta('ompe a met');
        throw new Error('network error: stream troncato');
      },
    };
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origOr,
      streamComplete: async ({ onDelta }) => {
        onDelta('Risposta pulita ');
        await new Promise((r) => setTimeout(r, 40));
        onDelta('del fallback.');
        return { text: 'Risposta pulita del fallback.', usage: {} };
      },
    };
  });

  // Apri il popup di spiegazione come farebbe Alt+E / menu tasto destro.
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN,
      payload: { selection: 'stream troncato', sentence: 'una frase con stream troncato dentro' },
      anchor: { x: 120, y: 120 },
      title: 'Spiega',
    });
  });

  const msg = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  // SUCCESSO: arriva la risposta del provider di fallback…
  await expect(msg).toContainText('Risposta pulita del fallback.', { timeout: 15_000 });
  // …e il costo in footer conferma che il turno è CHIUSO (siamo dopo il "done",
  // non a metà stream): il testo che vediamo è il messaggio finale.
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 5000 });
  // …SENZA alcun residuo del tentativo fallito (rosso senza il fix).
  await expect(msg).not.toContainText('TESTO-SPORCO');
  const finale = (await msg.textContent()) || '';
  expect(finale.trim()).toBe('Risposta pulita del fallback.');

  // Traccia visiva della run (gitignorata).
  try { await page.screenshot({ path: 'tests/.shots/stream-fallback-reset.png' }); } catch (_) {}

  await app.evaluate(() => {
    globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origGem;
    globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origOr;
  });
});

test('errore immediato del primo provider (nessun delta): fallback pulito come prima', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'flash-lite-3,flash-lite-or' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__origGem2 = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__origOr2 = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origGem2,
      streamComplete: async () => { throw new Error('401 unauthorized'); },
    };
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origOr2,
      streamComplete: async ({ onDelta }) => {
        onDelta('Risposta diretta del fallback.');
        return { text: 'Risposta diretta del fallback.', usage: {} };
      },
    };
  });

  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN,
      payload: { selection: 'x', sentence: 'frase con x' },
      anchor: { x: 120, y: 120 },
      title: 'Spiega',
    });
  });

  const msg = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  await expect(msg).toContainText('Risposta diretta del fallback.', { timeout: 15_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 5000 });
  const finale = (await msg.textContent()) || '';
  expect(finale.trim()).toBe('Risposta diretta del fallback.');

  await app.evaluate(() => {
    globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origGem2;
    globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origOr2;
  });
});
