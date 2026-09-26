// #724 — giro 1 di verifica. Filo capisce che un numero è un prezzo solo
// guardando il carattere attaccato al marker: se il modello mette in grassetto
// il numero e lascia l'euro fuori dal grassetto, l'importo torna a dodici cifre.
// Stessa causa, altra porta: la valuta scritta PRIMA del numero come parola.
//
// Successo per l'utente: comunque il modello scriva la frase, l'importo in
// euro si legge come un prezzo.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, pezzi) {
  await app.evaluate(async (_electron, pezziJson) => {
    const frammenti = JSON.parse(pezziJson);
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origProviderV724 = globalThis.__origProviderV724 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProviderV724,
      streamComplete: async ({ onDelta }) => {
        for (const p of frammenti) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 25));
        }
        return { text: frammenti.join(''), usage: {} };
      },
    };
  }, JSON.stringify(pezzi));
}

async function spiega(page, selection) {
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );
  await page.evaluate((sel) => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: sel, sentence: `Il biglietto costa ${sel}.` },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.35) },
      title: 'Approfondisci',
    });
  }, selection);
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
}

test('il numero in grassetto con l\'euro fuori resta un prezzo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaModello(app, ['3000 rupie indiane sono ', 'circa **[[calc: 3000/109.3]]**', ' € al cambio di oggi.']);
  await spiega(page, '3000 rupie');
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });

  const testo = await page.locator('.sn-popup-body').innerText();
  expect(testo, `l'importo non si legge come un prezzo: ${testo}`).toContain('27,45');
  expect(testo, 'tornano le dodici cifre della segnalazione').not.toContain('27,4473924977');
});

test('la valuta scritta prima del numero resta un prezzo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaModello(app, ['3000 rupie indiane: ', 'EUR [[calc: 3000/109.3]]', ' al cambio di oggi.']);
  await spiega(page, '3000 rupie');
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });

  const testo = await page.locator('.sn-popup-body').innerText();
  expect(testo, `l'importo non si legge come un prezzo: ${testo}`).toContain('27,45');
  expect(testo, 'tornano le dodici cifre della segnalazione').not.toContain('27,4473924977');
});
