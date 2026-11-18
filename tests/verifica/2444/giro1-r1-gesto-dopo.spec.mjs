// #2444 giro 1 — un tasto destro dato prima che il menu di una pagina di Filo ascolti, seguito da un altro gesto
// (clic sinistro altrove, Esc), non deve aprire il menu dopo: l'utente è già passato ad altro.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

// Le impostazioni del content script arrivano tardi: la finestra in cui il menu non ascolta ancora si allarga a `ms`.
async function rallentaImpostazioni(app, ms) {
  await app.evaluate(({ ipcMain }, ritardo) => {
    const mappa = ipcMain._invokeHandlers;
    const orig = globalThis.__verificaOrigMessage || mappa.get('filo:message');
    globalThis.__verificaOrigMessage = orig;
    mappa.set('filo:message', async (e, msg, ...resto) => {
      if (msg && msg.type === 'get_settings' && ritardo > 0) await new Promise((r) => setTimeout(r, ritardo));
      return orig(e, msg, ...resto);
    });
  }, ms);
}

const pronta = (page) => page.evaluate(() => document.documentElement.dataset.filoContentReady === '1');

for (const { nome, poi } of [
  { nome: 'un clic sinistro altrove', poi: (page) => page.mouse.click(5, 300) },
  { nome: 'Esc', poi: (page) => page.keyboard.press('Escape') },
]) {
  test(`r1 Preferenze: tasto destro e poi ${nome} prima che il menu ascolti: il menu non compare dopo`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    await rallentaImpostazioni(app, 1500);
    const page = await openTab('filo://preferences/preferences.html');
    const voce = page.locator('label', { has: page.locator('#tabPreviewEnabled') });
    await expect(voce).toBeVisible({ timeout: 10_000 });
    await voce.click({ button: 'right' });
    await poi(page);
    expect(await pronta(page)).toBe(false);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await menuDi(page).principale.count()).toBe(0);
  });
}
