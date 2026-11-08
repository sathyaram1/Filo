// Esplorazione del giro 4: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const leggi = (app, perc) => app.evaluate(async (_e, perc) => perc.split('.').reduce((x, k) => (x == null ? x : x[k]), await globalThis.SN_STORAGE.getSettings()), perc);

for (const caso of [
  { pagina: 'filo://preferences/preferences.html', id: 'dictationSilence', perc: 'dictation.silenceSec', set: { dictation: { silenceSec: 5 } } },
  { pagina: 'filo://preferences/preferences.html', id: 'ttsRate', perc: 'tts.rate', set: { tts: { rate: 1.6 } } },
  { pagina: 'filo://preferences/preferences.html', id: 'notifDuration', perc: 'notifications.durationSec', set: {} },
  { pagina: 'filo://options/options.html', id: 'monthlyLimit', perc: 'monthlyLimit', set: { monthlyLimit: 7 } },
  { pagina: 'filo://security/security.html', id: 'sec-adblock', perc: 'security.adblock.enabled', set: {} },
]) {
  test(`rimetti ${caso.id}`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    if (Object.keys(caso.set).length) await app.evaluate((_e, s) => globalThis.SN_STORAGE.updateSettings(s), caso.set);
    const page = await openTab(caso.pagina);
    const el = page.locator(`#${caso.id}`);
    await expect(el).toBeAttached({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const perc = await page.evaluate((id) => globalThis.SN_VOCI_IMPOSTAZIONI.campi(globalThis.SN_MENU_IMPOSTAZIONI.paginaDi())[id], caso.id);
    const prima = await leggi(app, perc);
    const uiPrima = await el.evaluate((x) => (x.type === 'checkbox' ? x.checked : x.value));
    const lab = await page.evaluate((id) => (document.getElementById(`${id}Val`) || {}).textContent || '', caso.id);
    await el.scrollIntoViewIfNeeded();
    const bersaglio = (await el.isVisible()) ? el : page.locator(`label:has(#${caso.id}), label[for="${caso.id}"]`).first();
    await bersaglio.click({ button: 'right' });
    await menuDi(page).voce('Rimetti di serie').first().click();
    await page.waitForTimeout(1500);
    const dopo = await leggi(app, perc);
    const uiDopo = await el.evaluate((x) => (x.type === 'checkbox' ? x.checked : x.value));
    const labDopo = await page.evaluate((id) => (document.getElementById(`${id}Val`) || {}).textContent || '', caso.id);
    console.log(`\n=== ${caso.id} ${perc}: salvato ${JSON.stringify(prima)} -> ${JSON.stringify(dopo)}; campo ${uiPrima} -> ${uiDopo}; etichetta «${lab}» -> «${labDopo}»`);
  });
}
