// #724 terzo giro — i cambi restano buoni un giorno intero. Chi aggiorna Filo
// avendo usato «Spiega» nelle ultime 24 ore si porta dietro l'elenco corto di
// prima (dieci valute): per un giorno «3000 rupie» va ancora a memoria del
// modello, cioè il caso della segnalazione.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <p id="p">Il biglietto costa 3000 rupie.</p>
</body></html>`;

test('i cambi salvati prima dell\'aggiornamento non tengono fuori le rupie', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__prompt724 = '';
    globalThis.__orig724 = globalThis.__orig724 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__orig724,
      complete: async ({ messages }) => {
        globalThis.__prompt724 = (messages || []).map((m) => m.content).join('\n');
        return { text: 'NESSUNA SPIEGAZIONE', toolCalls: [], reasoningDetails: [], usage: {} };
      },
    };
    // Esattamente quello che la versione precedente di Filo lasciava in
    // memoria: dieci valute, scaricate poche ore fa.
    await chrome.storage.local.set({
      sn_fx_rates: {
        base: 'EUR', date: '2026-09-26', fetchedAt: Date.now(),
        rates: { USD: 1.08, GBP: 0.85, CHF: 0.94, JPY: 165, CNY: 7.8, CAD: 1.47, AUD: 1.65, SEK: 11.2, NOK: 11.5, DKK: 7.46 },
      },
    });
  });

  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => {
    const p = document.querySelector('#p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#p').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => app.evaluate(() => globalThis.__prompt724), { timeout: 30_000 })
    .toContain('3000 rupie');

  const prompt = await app.evaluate(() => globalThis.__prompt724);
  // SUCCESSO: il modello ha davanti il cambio delle rupie, non dieci valute.
  expect(prompt, 'il cambio delle rupie non arriva al modello: converte a memoria o non converte')
    .toMatch(/\d[\d.]*\s+INR\b/);
});
