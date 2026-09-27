// Verifica #724.1, giro 2 — col servizio dei cambi che non risponde la chat non
// riaspetta la rete a ogni messaggio; un conto arrotondato «a due decimali»
// arriva all'utente come numero, non come marker grezzo.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function modelloFinto(app, rispostaDaTasso) {
  await app.evaluate(async (_e, src) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const risposta = new Function('tasso', `return (${src})(tasso)`);
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const m = /1 EUR = [^\n]*?([\d.]+) INR/.exec(prompt);
      globalThis.__chiamate.push({ at: Date.now(), tasso: m ? m[1] : null });
      const full = risposta(m ? m[1] : null);
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, rispostaDaTasso.toString());
}

async function manda(page, testo) {
  const prima = await page.locator('.dash-bubble-filo').count();
  const t0 = await page.evaluate(() => Date.now());
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(prima + 1, { timeout: 15_000 });
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 15_000 });
  return t0;
}

test('servizio dei cambi fermo: dopo il primo messaggio la chat non riaspetta la rete', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    try { await chrome.storage.local.remove('sn_fx_rates'); } catch (_) {}
    const orig = globalThis.fetch;
    globalThis.fetch = (url, opts) => {
      if (String(url).includes('frankfurter')) {
        return new Promise((_, rej) => {
          const s = opts && opts.signal;
          if (s) s.addEventListener('abort', () => rej(new Error('aborted')));
        });
      }
      return orig(url, opts);
    };
  });
  await modelloFinto(app, () => 'Ciao!');

  const t1 = await manda(page, 'ciao');
  const t2 = await manda(page, 'come stai?');
  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  expect(chiamate.length).toBe(2);
  expect(chiamate[0].at - t1, 'il primo messaggio aspetta al più il tetto della rete').toBeLessThan(5_500);
  expect(chiamate[1].at - t2, 'il secondo messaggio non riaspetta il servizio dei cambi').toBeLessThan(1_500);
  expect(chiamate[1].tasso, 'anche col servizio fermo il modello ha un cambio della rupia').toBeTruthy();
});

test('un conto arrotondato a due decimali arriva come numero, non come marker grezzo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  // Il prompt della chat elenca round fra le funzioni: un modello che lo usa
  // alla maniera comune, round(x, 2), è un caso normale.
  await modelloFinto(app, (tasso) => `3000 rupie sono circa [[calc: round(3000/${tasso}, 2) | eur]] €.`);

  await manda(page, 'Quanto fanno 3000 rupie in euro');
  const tasso = (await app.evaluate(() => globalThis.__chiamate))[0].tasso;
  expect(tasso).toBeTruthy();
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).not.toContainText('[[');
  const atteso = (3000 / Number(tasso)).toFixed(2).replace('.', ',');
  await expect(bolla).toContainText(`${atteso} €`);
});
