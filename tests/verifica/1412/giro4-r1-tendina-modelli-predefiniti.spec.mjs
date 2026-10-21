// #1412 giro 4, rilievo 1: nei Modelli predefiniti la tendina della durata della cache sta sulla riga della sua
// etichetta, accanto a giorni e tetto in token, e non va a capo larga quanto la pagina.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 la tendina della durata della cache sta accanto alla sua etichetta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://admin-defaults/admin-defaults.html');
  await page.addInitScript(() => {
    const cfg = {
      apiKeysPresent: { openrouter: true }, modelRegistry: {}, models: {}, excludedProviders: [],
      contestoFilo: {}, contestoFiloDiSerie: { giorni: 3, token: 100000, cache: '1h' },
    };
    const stub = async (msg) => (msg.type === 'defaults_get' ? { ok: true, config: cfg } : { ok: true, items: [] });
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  const tendina = page.locator('.sn-select-wrap', { has: page.locator('#contestoCache') });
  await expect(tendina.locator('.sn-select-value')).toHaveText(/un'ora/, { timeout: 5_000 });
  const etichetta = await page.locator('#l-contesto-cache').boundingBox();
  const giorni = await page.locator('#contestoGiorni').boundingBox();
  const box = await tendina.boundingBox();
  // Stessa riga dei campi accanto, e larga quanto le serve, non tutta la sezione.
  expect(Math.abs(box.y + box.height / 2 - (giorni.y + giorni.height / 2))).toBeLessThan(12);
  expect(box.x).toBeGreaterThan(etichetta.x);
  expect(box.width).toBeLessThan(400);
});
