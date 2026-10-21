// Esplorazione del giro 4 di #1412: tendine della durata della cache (Preferenze e Modelli predefiniti), temi.
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = 'tests/.shots/1412-giro4';

test('preferenze: tendina chiusa, scelta, ritorno al predefinito, temi', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const pref = await openTab('filo://preferences/preferences.html');
  const sel = pref.locator('#contestoCache');
  await expect(pref.locator('#contestoCachePredefinita')).toHaveText(/un'ora/, { timeout: 10_000 });
  const vis = pref.locator('.sn-select-wrap', { has: sel }).locator('.sn-select-value');
  await expect(vis).toHaveText(/un'ora/);
  await vis.scrollIntoViewIfNeeded();
  const box = pref.locator('.sn-select-wrap', { has: sel }).locator('xpath=ancestor::section[1]');
  await box.screenshot({ path: `${SHOTS}/pref-chiara.png` });
  await sel.selectOption('5m');
  await expect(vis).toHaveText('5 minuti');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo.cache)).toBe('5m');
  await sel.selectOption('');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo.cache)).toBe(null);
  await expect(vis).toHaveText(/un'ora/);
  // Cambio fatto altrove (la chat) con la pagina aperta: la tendina lo segue.
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ contestoFilo: { cache: '5m' } }));
  await expect(vis).toHaveText('5 minuti', { timeout: 5_000 });
  await pref.locator('#theme').selectOption('dark');
  await pref.waitForTimeout(400);
  await box.screenshot({ path: `${SHOTS}/pref-scura.png` });
  // Apertura della tendina, scura.
  await pref.locator('.sn-select-wrap', { has: sel }).locator('button').first().click();
  await pref.waitForTimeout(300);
  await box.screenshot({ path: `${SHOTS}/pref-scura-aperta.png` });
});

test('modelli predefiniti: tendina chiusa con la durata di serie, salvataggio', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://admin-defaults/admin-defaults.html');
  await page.addInitScript(() => {
    window.__sent = [];
    const cfg = {
      apiKeysPresent: { openrouter: true }, modelRegistry: {}, models: {}, excludedProviders: [],
      contestoFilo: {}, contestoFiloDiSerie: { giorni: 3, token: 100000, cache: '1h' },
    };
    const stub = async (msg) => {
      window.__sent.push(msg);
      if (msg.type === 'defaults_get') return { ok: true, config: cfg };
      if (msg.type === 'defaults_update') return { ok: true, config: { ...cfg, contestoFilo: (msg.config && msg.config.contestoFilo) || {} } };
      return { ok: true, items: [] };
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  const sel = page.locator('#contestoCache');
  const vis = page.locator('.sn-select-wrap', { has: sel }).locator('.sn-select-value');
  await expect(vis).toHaveText(/un'ora/, { timeout: 5_000 });
  expect(await vis.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const box = page.locator('.sn-select-wrap', { has: sel }).locator('xpath=ancestor::section[1]');
  await vis.scrollIntoViewIfNeeded();
  await box.screenshot({ path: `${SHOTS}/admin.png` });
  await sel.selectOption('5m');
  const salva = page.locator('#save, #saveBtn, button:has-text("Salva")').first();
  await salva.click();
  await expect.poll(() => page.evaluate(() => {
    const u = window.__sent.filter((m) => m.type === 'defaults_update').pop();
    return u && u.config && u.config.contestoFilo ? u.config.contestoFilo.cache : null;
  })).toBe('5m');
});
