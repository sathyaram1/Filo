// #520 — "si è bloccato e non vedo risposta nonostante sia passato molto
// tempo": quando il modello non risponde, la bolla restava su "Filo sta
// pensando…" per sempre e la chat rimaneva occupata — nessun modo di uscirne
// se non chiudere la scheda. Qui il provider finto NON risponde mai (come un
// router che accetta e poi tace) e si asserisce il successo dal punto di vista
// dell'utente: vede da quanto sta aspettando, può fermare l'attesa, la
// richiesta al modello viene davvero annullata e il messaggio dopo riceve
// risposta.

import { test, expect } from './fixtures/electron.mjs';

// Provider finto: il PRIMO turno resta appeso finché non lo si annulla, i
// successivi rispondono subito. Registra se l'annullamento è arrivato davvero
// fino alla chiamata (altrimenti si pagherebbero token per una risposta che
// nessuno leggerà).
async function mockProviderAppeso(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__turni = 0;
    globalThis.__annullato = false;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, signal }) => {
      globalThis.__turni += 1;
      if (globalThis.__turni === 1) {
        return new Promise((_res, rej) => {
          const fine = () => {
            globalThis.__annullato = true;
            const e = new Error('This operation was aborted');
            e.name = 'AbortError';
            rej(e);
          };
          if (!signal) return;            // nessun segnale: appeso per sempre
          if (signal.aborted) { fine(); return; }
          signal.addEventListener('abort', fine, { once: true });
        });
      }
      return {
        text: JSON.stringify({ reply: 'Eccomi, il mazzo mi sembra a buon punto.' }),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  });
}

test('un\'attesa senza risposta si vede, si ferma, e dopo la chat funziona', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockProviderAppeso(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await page.fill('#chatInput', 'che ne pensi del mazzo?');
  await page.press('#chatInput', 'Enter');

  // L'attesa è visibile e ha una via d'uscita.
  const attesa = page.locator('.dk-msg-bot .dk-msg-pending');
  await expect(attesa).toContainText('sta pensando');
  const stop = page.locator('[data-stop-chat]');
  await expect(stop).toBeVisible();

  // Dopo qualche secondo si legge da quanto si sta aspettando.
  await expect(page.locator('[data-attesa]')).toHaveText(/\d+s/, { timeout: 20_000 });

  await stop.click();

  // La bolla dice cosa è successo, senza spacciarlo per un errore del servizio.
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Attesa interrotta');
  await expect(page.locator('[data-stop-chat]')).toHaveCount(0);

  // L'annullamento è arrivato fino alla chiamata al modello.
  await expect.poll(() => app.evaluate(() => globalThis.__annullato), { timeout: 10_000 }).toBe(true);

  // E soprattutto: la chat è di nuovo libera e il messaggio dopo riceve risposta.
  await page.fill('#chatInput', 'e adesso?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('a buon punto');
});
