// #830.4 giro 1 — esplorazione: le altre grafie dell'indirizzo della home.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false });

async function config(app) {
  await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = globalThis.__filoDefaultsGet || Defaults.get;
    globalThis.__filoDefaultsGet = origGet;
    Defaults.get = () => ({ ...origGet(), provider: 'gemini' });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    const P = globalThis.SN_PROVIDERS;
    const r = (a) => ({ text: JSON.stringify({ message: 'Buongiorno.', suggestions: [] }), model: a[0].model, provider: a[0].provider, usage: {} });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => { const x = r(attempts); try { onDelta && onDelta(x.text); } catch (_) {} return x; };
    P.completeWithFallback = async ({ attempts }) => r(attempts);
  });
}

for (const indirizzo of ['filo://newtab/newtab.html', 'filo://newtab/NEWTAB.HTML', 'filo://dashboard/dashboard.html', 'filo://dashboard/', 'filo://newtab/dashboard.html']) {
  test(`esplora ${indirizzo}`, async ({ app, shell, openTab }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await config(app);
    const page = await openTab(indirizzo);
    await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
    let stato = null;
    try {
      await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
      await expect(page.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo', { timeout: 10_000 });
      stato = 'accoglienza';
    } catch (e) { stato = 'NO: ' + (await page.locator('body').getAttribute('data-state').catch(() => '?')); }
    const etichette = await shell.locator('.tab').allInnerTexts();
    const url = page.url();
    await page.screenshot({ path: `tests/.shots/830.4-${indirizzo.replace(/[^a-z0-9]+/gi, '_')}.png` }).catch(() => {});
    console.log(`ESITO ${indirizzo} → ${stato} | url ${url} | schede ${JSON.stringify(etichette)}`);
  });
}
