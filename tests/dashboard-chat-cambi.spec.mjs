// #724.1 — «Quanto fanno 3000 rupie in euro» scritto nella chat della home:
// il modello deve ricevere i cambi del giorno, e il numero che l'utente legge
// deve averlo calcolato Filo, già mentre la risposta scorre.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('la chat converte le rupie col cambio del giorno e il conto lo fa Filo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // Un cambio che nessun ripiego ha: se arriva al modello, arriva da qui.
    globalThis.SN_FX.get = async () => ({ base: 'EUR', date: '2026-09-26', rates: { INR: 100, USD: 1.1 } });
    globalThis.__prompts = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__prompts.push(messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n---\n'));
      const sys = String(messages[0].content || '');
      const conCambi = sys.includes('CAMBI:') && sys.includes('100.0 INR');
      const testo = conCambi
        ? '3000 rupie sono circa [[calc: 3000/100 | eur]] €, al cambio del 26 settembre.'
        : 'Circa 33 euro.';
      // Il marker arriva spezzato fra due pezzi, come in un vero streaming.
      const taglio = testo.indexOf('3000/100');
      for (const pezzo of [testo.slice(0, taglio), testo.slice(taglio)]) {
        try { onDelta && onDelta(pezzo); } catch (_) {}
        await new Promise((r) => setTimeout(r, 600));
      }
      return { text: testo, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('Quanto fanno 3000 rupie in euro');
  await page.locator('#sendBtn').click();

  // Mentre scorre, il pezzo di marker non si vede.
  await expect.poll(() => page.evaluate(() => document.querySelector('.dash-bubble-streaming')?.textContent || null),
    { timeout: 5_000, intervals: [60] }).toContain('3000 rupie sono circa …');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'al cambio del 26 settembre' });
  await expect(bolla).toBeVisible({ timeout: 8_000 });
  await expect(bolla).toContainText('3000 rupie sono circa 30,00 €');
  await expect(page.locator('.dash-bubble-filo', { hasText: '[[calc' })).toHaveCount(0);
  try { await page.screenshot({ path: 'tests/.shots/dashboard-chat-cambi.png' }); } catch (_) {}

  // La domanda dopo rimanda al modello il numero, non il marker: quello che
  // l'utente ha letto e quello che il modello ricorda coincidono.
  await page.locator('#input').fill('e in dollari?');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__prompts.length), { timeout: 8_000 }).toBe(2);
  const secondo = await app.evaluate(() => globalThis.__prompts[1]);
  expect(secondo).toContain('3000 rupie sono circa 30,00 €');
  expect(secondo).not.toContain('[[calc: 3000/100');
});
